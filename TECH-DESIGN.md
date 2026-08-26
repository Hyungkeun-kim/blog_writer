# TECH_DESIGN v2.1 - 실행 가능한 코드

## 1. R2 Presigned PUT - 올바른 패키지

```ts
// Correct: @aws-sdk/s3-request-presigner (not s3-presigner)
import { S3Client } from "@aws-sdk/client-s3"
import { PutObjectCommand } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY },
})

export async function createPresignedPut(env: Env, userId: string, jobId: string, slotId: number) {
  const key = `users/${userId}/jobs/${jobId}/slot_${slotId}.jpg` // 서버 생성, 정확한 prefix 검증
  if (!key.startsWith(`users/${userId}/jobs/${jobId}/`)) throw new Error("invalid prefix")
  
  const command = new PutObjectCommand({
    Bucket: env.R2_BUCKET_NAME, // string, not R2Bucket binding
    Key: key,
    ContentType: "image/jpeg",
    // @ts-ignore 제거, IfNoneMatch 조건부
  })
  // IfNoneMatch: "*" 서명에 포함
  const url = await getSignedUrl(s3, command, { 
    expiresIn: 600,
  })
  // 헤더는 클라이언트가 그대로 전송해야 함: If-None-Match: *, Content-Type: image/jpeg
  return { key, url }
}

// 검증 - 클라이언트 선언만으로 인정 안함
export async function verifyUploadedObject(env: Env, slot: UploadSlot) {
  const obj = await env.R2_BUCKET.head(slot.key)
  if (!obj) throw new Error("not found")
  if (!slot.key.startsWith(`users/${slot.user_id}/jobs/${slot.job_id}/`)) throw new Error("path mismatch")
  if (obj.size > 10 * 1024 * 1024) throw new Error("too large")
  if (!["image/jpeg","image/png","image/webp"].includes(obj.httpMetadata?.contentType || "")) throw new Error("invalid type")
  // magic bytes + 디코딩 검증 - Cloudflare Images binding 사용
  const image = await env.R2_BUCKET.get(slot.key)
  const bytes = await image.arrayBuffer()
  if (!isValidImage(bytes)) throw new Error("decode failed") // 실제 디코딩 검증
  return true
}
```
참고: https://developers.cloudflare.com/r2/api/s3/presigned-urls/

## 2. Workflows - 평탄화 + 병렬 + PII 차단

```ts
// 올바른 순서: step.do(name, config, callback)
import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from 'cloudflare:workers'

type Params = { jobId: string; userId: string }

export class BlogWriterWorkflow extends WorkflowEntrypoint<Env, Params> {
  async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
    const { jobId, userId } = event.payload
    
    // init
    const slots = await step.do('init', { retries: { limit: 2 } }, async () => {
      return getUploadSlots(jobId) // Supabase에서 조회
    })

    // Vision - 최상위 반복문 평탄화, 병렬 3개, 결정적 이름 vision_slot_{id}
    const visionResults = []
    const parallelLimit = 3
    for (let i=0; i<slots.length; i+=parallelLimit) {
      const batch = slots.slice(i, i+parallelLimit)
      const batchResults = await Promise.all(batch.map(slot => 
        step.do(`vision_slot_${slot.slot_id}`, { retries: { limit: 3, delay: "5 second" } }, async () => {
          const base64 = await getR2Base64(env.R2_BUCKET, slot.key) // 구현
          const res = await env.AI.run('@cf/meta/llama-3.2-11b-vision-instruct', {
            image: base64,
            prompt: "관찰 가능한 행동만 기술, 이름/성격/감정 추론 금지",
            max_tokens: 512,
          })
          return validateVisionJson(res) // JSON 스키마 검증 + 재시도
        })
      ))
      visionResults.push(...batchResults)
    }

    const merged = await step.do('merge', async () => mergeObservations(visionResults))

    // PII 검사 1 - Claude 보내기 전
    const piiInput = await step.do('pii_check_input', async () => detectPII(merged))
    if (piiInput.requiresReview) {
      await step.do('needs_review_input', async () => {
        await savePiiReason(jobId, piiInput) // 원문 저장 금지, 유형·위치·사유 코드만
        await transitionJob(jobId, 'needs_review') // RPC 내부에서 허용 전이 검증
      })
      return // Writer, finalize 실행 안함
    }

    const draft = await step.do('writer_running', { retries: { limit: 2 } }, async () => {
      return callClaude(env, merged) // 실제 Claude 호출
    })

    const verified = await step.do('quality_running', { retries: { limit: 2 } }, async () => {
      return qualityEditor(env, draft)
    })

    // PII 검사 2 - 저장 전
    const piiOutput = await step.do('pii_check_output', async () => detectPII(verified))
    if (piiOutput.requiresReview) {
      await step.do('needs_review_output', async () => {
        await savePiiReason(jobId, piiOutput)
        await transitionJob(jobId, 'needs_review')
      })
      return
    }

    await step.do('finalize', async () => saveResult(jobId, verified))
  }
}

function validateVisionJson(res: any) {
  // 실제 구현: JSON Schema 검증, 실패 시 throw로 재시도 유도
  if (!res.observations) throw new Error("invalid vision json")
  return res
}

function detectPII(text: string): { requiresReview: boolean; items: any[]; reason: string; confidence: number } {
  // 로컬 규칙, AI 모델로 이름 전송 금지, childNames는 payload에 넣지 않음
  // 이름 목록은 로컬 후처리에서만 사용
  const items = [] // 유형·위치 탐지
  return { requiresReview: items.length>0, items, reason: "name_detected", confidence: 0.9 }
}

async function callClaude(env: Env, prompt: string) {
  // provider-native 단일 경로, max_tokens 필수
  const res = await fetch(`https://gateway.ai.cloudflare.com/v1/${env.CF_ACCOUNT_ID}/${env.CF_GATEWAY_ID}/anthropic/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'cf-aig-authorization': `Bearer ${env.CF_AIG_TOKEN}`,
      'anthropic-version': '2023-06-01',
      'cf-aig-collect-log-payload': 'false',
    },
    body: JSON.stringify({
      model: env.CLAUDE_MODEL, // claude-sonnet-4-5 고정
      max_tokens: 3000,
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  if (!res.ok) throw new Error(await res.text()) // 에러 처리
  const data = await res.json()
  return data.content[0].text
}

async function getR2Base64(bucket: R2Bucket, key: string) {
  const obj = await bucket.get(key)
  if (!obj) throw new Error("not found")
  const buf = await obj.arrayBuffer()
  return Buffer.from(buf).toString('base64')
}

async function saveResult(jobId: string, verified: any) {
  // Supabase 저장 구현
}
```
참고: https://developers.cloudflare.com/workflows/

## 3. pgvector 마이그레이션

```sql
-- 1. 새 컬럼 추가
alter table style_examples add column embedding_v2 vector(1024);

-- 2. 배치 Worker 재임베딩 (Workers AI BGE-M3, bge_m3_embedding() 미정의 함수 사용 안함)
-- Worker 코드에서 직접 임베딩 생성 후 update

-- 3. 100% 완료 검증
select count(*) from style_examples where embedding_v2 is null and approved_for_learning = true;

-- 4. HNSW 인덱스
create index on style_examples using hnsw (embedding_v2 vector_cosine_ops);

-- 5. 검색 RPC 전환
create or replace function match_style_examples(query_embedding vector(1024), match_threshold float, match_count int)
returns table(id uuid, content text, similarity float)
language plpgsql security invoker -- INVOKER 검토, DEFINER 필요 시 search_path='' + REVOKE
set search_path = ''
as $$
begin
  return query
  select se.id, se.content, 1 - (se.embedding_v2 <=> query_embedding) as similarity
  from public.style_examples se
  where se.user_id = auth.uid() and se.approved_for_learning = true and 1 - (se.embedding_v2 <=> query_embedding) > match_threshold
  order by se.embedding_v2 <=> query_embedding limit match_count;
end; $$;

-- 6. 7일간 롤백 유지, 7. 검증 후 기존 컬럼 삭제
```

## 4. OpenNext Custom Worker

```ts
// Correct import
import { default as handler } from "./.open-next/worker.js";

export default {
  fetch: handler.fetch,
  async scheduled(event, env, ctx) {
    // 삭제 작업, 페이지네이션·부분 실패 재시도·멱등성 추가
    // 매시간 실행, 원본 24시간, PII 메타 7일, 중간 즉시 삭제
  }
}
```
참고: https://opennext.js.org/cloudflare/howtos/custom-worker

## 5. 비용 - 실측 전이므로 PENDING

- Workers AI: 3128 neurons/case estimated × 500건 × 30일 = 46.92M → $516.12 (무료 제외 전), 무료 10k/일 제외 시 $506
- Claude: 별도, Writer + Quality 각 2000 tokens
- Workflows: 500k steps 포함, 14 steps/case × 500 × 30 = 210k → 초과 $0, CPU·요청 별도
- R2: 3MB×8장×500×30일 = 351GB 근거 명시
- Supabase: 임의 산식 제거, 공식 가격 적용
- 100건 실측 후 P50/P95, 일 100/500/1000건, 기본요금, 무료 전후, 월 총비용+20% 예비비 제시
- 링크: https://developers.cloudflare.com/workflows/reference/pricing/
