# blog_writer 기술 설계 v3.0

**상태:** TARGET · 미구현 항목 포함

이 문서는 구현 계약이다. 현재 Cloudflare 단일 Worker 코드는 일부 구성요소만 구현하며 Firebase Authentication과 Cloud Run BFF를 포함한 v3 전체 구현이 아니다.

## 1. 구성요소

```text
Browser
  ├─ Firebase Auth SDK
  ├─ image normalizer
  └─ BFF API client
        ↓ HTTPS + Firebase ID token
Cloud Run BFF
  ├─ Firebase token verifier
  ├─ OWNER_EMAILS authorization
  ├─ request validation/rate limit
  └─ Worker service client
        ↓ HTTPS + internal service token
Cloudflare Worker
  ├─ D1 repository
  ├─ R2 repository
  ├─ Workers AI client
  └─ Workflows binding
```

### 저장 책임

| 구성요소 | 책임 |
|---|---|
| D1 | Job·slot 메타데이터, 상태, 설정, 설정 snapshot, usage event/일별 집계, 최종 글 메타데이터 |
| R2 jobs/images | 정규화 이미지 |
| R2 jobs/temp | Vision·Writer·Quality 결과와 최종 후보 |
| R2 posts | 최종 Markdown |

D1에는 사진 바이트, AI 중간 본문 또는 최종 Markdown 본문을 저장하지 않는다.

## 2. 인증 계약

### Browser → BFF

- `Authorization: Bearer <Firebase ID token>`
- BFF는 Firebase Admin SDK로 token을 검증한다.
- `iss`, `aud`, `exp`, `email_verified`를 확인한다.
- token의 이메일이 `OWNER_EMAILS` exact allowlist에 없으면 403이다.
- owner ID는 검증된 Firebase UID로 결정한다.

### BFF → Worker

- BFF는 Secret Manager의 회전 가능한 내부 service token을 사용한다.
- Worker는 내부 token을 상수 시간 비교하고 누락·불일치를 401로 거부한다.
- 외부 요청의 owner ID, object key와 상태를 신뢰하지 않는다.
- 허용 origin만 CORS에 등록하며 `*`와 credential 조합을 사용하지 않는다.

기본 PIN, 공개 token, `startsWith` 인증과 localStorage fallback token은 금지한다.

## 3. 공개 API와 내부 API

아래 공개 API는 Cloud Run BFF가 제공한다. Worker endpoint는 동일 기능의 내부 계약이며 인터넷 클라이언트가 직접 호출할 수 없다.

```text
POST   /api/jobs
PUT    /api/jobs/{jobId}/photos/{slotId}
POST   /api/jobs/{jobId}/start
POST   /api/jobs/{jobId}/pii-decision
GET    /api/jobs/{jobId}
GET    /api/jobs/{jobId}/result
POST   /api/jobs/{jobId}/confirm-final
POST   /api/jobs/{jobId}/cancel

GET    /api/posts
GET    /api/posts/{postId}
DELETE /api/posts/{postId}

GET    /api/settings
PUT    /api/settings
GET    /api/usage?date=YYYY-MM-DD
```

공통 규칙:

- BFF가 owner ID를 내부 요청에 주입한다.
- 생성·결정·확정·취소에는 idempotency key를 요구한다.
- 오류 응답은 `code`, 일반 사용자용 한국어 `message`, 선택적 `retryable`만 반환한다.
- 내부 stack, D1/R2 이름, object key와 secret을 반환하지 않는다.

### PII 결정 요청

```json
{
  "stage": "input",
  "decision": "continue",
  "reviewHash": "sha256:...",
  "reviewToken": "opaque-one-time-token"
}
```

`stage`는 `input | output`, `decision`은 `continue | cancel_and_purge`만 허용한다.

- 입력 review token은 Job, owner, Vision 병합 artifact의 `observation_hash`와 만료에 연결한다.
- 출력 review token은 Job, owner, 출력 후보의 `candidate_hash`와 만료에 연결한다.
- token은 한 번만 사용한다.
- 출력 `continue`는 편집 payload 또는 위험 acknowledgement를 받아 재검사하고 새 candidate hash를 발급한 뒤 `waiting(final_review)`로 전환한다.

### 최종 저장 요청

```json
{
  "candidateHash": "sha256:...",
  "acknowledged": true,
  "piiAcknowledged": false,
  "title": "...",
  "body": "...",
  "tags": ["..."]
}
```

요청 본문 hash가 candidate hash와 다르면 새 PII 검사와 사용자 확인을 요구한다.

## 4. 이미지 정규화와 검증

### 브라우저

1. JPEG/PNG/WebP 파일을 디코딩한다.
2. EXIF orientation을 반영한다.
3. 비율을 유지하며 긴 변을 최대 2048px로 줄인다.
4. Canvas에서 WebP 품질 0.82로 재인코딩한다.
5. 원본 파일명과 metadata 없이 Blob만 BFF에 전송한다.
6. 처리 직후 object URL과 원본 참조를 해제한다.

### BFF/Worker

- 인증과 Job·slot 소유권을 확인한다.
- 전송 크기는 10MiB 이하만 허용한다.
- MIME header와 WebP magic bytes가 모두 일치해야 한다.
- 실제 이미지 디코딩에 성공하고 긴 변이 2048px 이하인지 확인한다.
- EXIF/XMP/ICC 등 허용하지 않은 metadata chunk가 있으면 거부한다.
- 서버가 생성한 object key에만 조건부 저장한다.
- 검증된 바이트 checksum을 D1에 기록하고 같은 바이트를 Vision에 전달한다.

객체 키:

```text
users/{ownerId}/jobs/{jobId}/images/slot_{slotId}.webp
users/{ownerId}/jobs/{jobId}/temp/{artifactId}
users/{ownerId}/posts/{postId}.md
```

## 5. 상태와 데이터 모델

```ts
type JobStatus =
  | "waiting"
  | "processing"
  | "reupload_required"
  | "completed"
  | "failed"

type WaitingReason =
  | "upload"
  | "pii_review"
  | "final_review"
  | null
```

주요 Job 필드:

```text
id, owner_id, idempotency_key, status, waiting_reason,
progress_stage, failure_code, cleanup_pending, expires_at,
observation_hash, candidate_hash, pii_warning_categories, pii_ack_required,
pii_acknowledged_at, final_acknowledged_at, settings_snapshot
```

- `pii_warning_categories`에는 enum code만 저장하고 원문과 위치 문자열을 저장하지 않는다.
- `settings_snapshot`은 Job 생성 시 확정하며 이후 사용자 설정 변경의 영향을 받지 않는다.
- 모든 전이는 expected status와 waiting reason을 조건으로 하는 compare-and-set이다.
- `completed`는 일반 transition 함수가 아니라 finalization 함수만 설정할 수 있다.

## 6. Workflow

```text
init
→ vision_slot_{id} (최대 3개 병렬)
→ merge
→ pii_input
   ├─ detected: waiting(pii_review)
   │    ├─ continue: sanitize → recheck → writer
   │    └─ cancel: purge → failed
   └─ clear: writer
→ quality
→ pii_output
   ├─ detected: waiting(pii_review)
   │    ├─ edit/confirm: recheck → clear 또는 위험 acknowledgement → 새 candidate hash → waiting(final_review)
   │    └─ cancel: purge → failed
   └─ clear: waiting(final_review)
→ confirm-final API
→ pending final 저장
→ purge temp
→ verify purge
→ completed + visible
```

- Vision은 사진별 최대 1회 자동 재시도한다.
- Vision 결과는 구조화 JSON schema로 검증한다.
- Writer와 Quality는 서로 다른 단계로 실제 모델을 호출한다.
- PII 대기 이후 resume은 원래 Workflow instance와 Job checkpoint를 사용한다. 전체 파이프라인을 처음부터 재실행하지 않는다.
- continue 시 모든 탐지 범주에 대응하는 sanitizer를 적용하고 재검사 실패 시 다음 단계로 이동하지 않는다.
- output PII가 남은 최종 후보는 경고와 함께 소유자에게만 제공한다.
- 출력 PII 검토 후 편집 또는 위험 확인 요청은 저장 직전 재검사를 수행하고, 새 candidate hash를 발급한 뒤 `waiting(final_review)`로 전환한다.
- 사진, 프롬프트와 결과 본문은 Workflow step 이름·로그·payload에 넣지 않고 R2 artifact reference와 hash만 전달한다.

## 7. AI 모델

서버 allowlist:

| 역할 | 기본 | 대안 |
|---|---|---|
| Vision | Llama 3.2 Vision | Llama 4 Scout |
| Writer | Gemma 4 | GLM 4.7 Flash |
| Quality | Gemma 4 | GLM 4.7 Flash |

- 실제 Cloudflare 모델 ID는 배포 시 지원 여부를 검증한 allowlist 상수로 관리한다.
- Vision prompt는 관찰 가능한 대상·행동·장소·보이는 문자만 요청한다.
- 이름, 감정, 성격, 건강·발달과 가족관계를 추론하지 않는다.
- Writer와 Quality에는 PII 검사를 통과한 파생 텍스트만 전달한다.
- Claude와 기타 외부 provider 경로는 비활성화한다.

## 8. 최종화와 삭제

```ts
async function finalizeByOwner(input: FinalizeInput) {
  const job = await lockOwnedJob(input.ownerId, input.jobId)
  assertWaiting(job, "final_review")
  assertAcknowledgement(input)
  assertCandidateHash(job, input)
  await recheckFinalPayload(input)

  const markdownKey = await putPendingMarkdown(input)
  const postId = await insertPendingPostMetadata(markdownKey)

  await purgeExactTemporaryObjects(job)
  await assertNoTemporaryArtifactsRemain(job)

  await completeJobAndExposePostInOneD1Transaction(job.id, postId)
}
```

- D1 post metadata에는 `id, owner_id, title, summary, r2_markdown_key, status, created_at`만 저장한다.
- 삭제 오류가 있으면 `cleanup_pending=true`를 유지하고 completed로 전환하지 않는다.
- cleanup은 지수 backoff로 재시도한다.
- 최종 글 DELETE는 R2 Markdown 삭제, D1 metadata 삭제와 잔존 확인을 멱등하게 수행한다.

## 9. 만료

- Job의 `expires_at`은 `min(created_at + retentionHours, created_at + 24h)`로 생성하며 상태 변경으로 연장하지 않는다.
- 정규화 이미지, 임시 artifact와 PII 임시 필드는 Job 절대 만료를 넘지 않는다.
- Workflow는 가장 이른 `expires_at` 전에 deadline cleanup을 예약한다.
- 최소 시간 단위 Cron이 누락된 Job과 `cleanup_pending`을 재처리한다.
- R2 Lifecycle은 최종 안전망으로 설정한다.
- 만료된 `waiting`, `processing`, `reupload_required` Job은 모두 `failed(SOURCE_EXPIRED)`로 바꾸고 임시 데이터와 PII 임시 필드를 제거한다.
- cleanup과 취소는 사용량 한도와 관계없이 항상 실행한다.

배포 게이트는 Worker scheduled handler의 존재뿐 아니라 실제 Cron trigger와 R2 Lifecycle 설정도 확인한다.

## 10. 설정

```ts
type UserSettings = {
  retentionHours: number       // 1..24
  maxImageBytes: 5242880 | 10485760
  visionModel: AllowedVisionModel
  writerModel: AllowedWritingModel
  qualityModel: AllowedWritingModel
  maxOutputTokens: number      // 서버 지정 범위
  parallelVisionSlots: 1 | 2 | 3
}
```

- PUT은 위 키만 허용하고 unknown key를 400으로 거부한다.
- 모델 ID와 숫자 범위는 서버에서 검증한다.
- 환경, binding, owner allowlist, service token과 PII 우회 옵션은 설정 API 대상이 아니다.
- 화면에는 사용자가 이해하기 쉬운 이름을 표시하고 기술 ID는 보조 설명으로만 제공한다.
- secret 상태는 `configured | missing`과 마스킹된 suffix만 표시한다.

## 11. 사용량

```text
ai_usage_events:
  id, owner_id, job_id, utc_date, model_id, stage,
  input_tokens, output_tokens, neurons, measurement(actual|estimated)
```

- 실제 provider usage가 있으면 `actual`, 없으면 문서화된 계산식에 따른 `estimated`로 구분한다.
- `GET /api/usage?date=YYYY-MM-DD`는 해당 UTC 날짜만 집계한다.
- 응답에는 모델·단계별 값, 합계, 10,000 neurons 참고 한도, 비율과 마지막 갱신 시각을 포함한다.
- 70%는 주의, 90%는 강한 경고이며 자동 차단하지 않는다.
- 실제 청구와 무료 할당은 Cloudflare Dashboard가 최종 기준이라는 안내를 함께 표시한다.

## 12. 현재 구현과의 차이

다음은 v3 구현 완료 조건이며 현재 코드에서 미완료다.

- Firebase Authentication과 Cloud Run BFF
- Worker 직접 호출 차단과 안전한 내부 service token
- 서버의 WebP 실제 디코딩·치수·metadata 검증
- 단일 Workflow 기반 PII pause/resume
- 모든 PII 범주 sanitizer와 저장 전 acknowledgement/hash 검증
- 임시 artifact 및 최종 본문의 R2 전용 저장
- 배포 Cron과 R2 Lifecycle 검증
- 설정 allowlist·Job snapshot
- 실제 UTC 일별 usage와 70%·90% 경고
- 문체 학습·외부 URL 수집 UI/API 비활성화

현재 코드와 화면이 동작한다는 사실만으로 이 TARGET 계약을 통과한 것으로 간주하지 않는다.
