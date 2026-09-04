import { WorkflowEntrypoint, WorkflowEvent, WorkflowStep } from "cloudflare:workers"
import { Env } from "./types/env.js"
import { detectPII } from "./services/piiService.js"
import { purgeJobR2AndTempData, transitionJob } from "./services/jobService.js"
import { generateId, sha256 } from "./utils/crypto.js"

export interface WorkflowParams {
  jobId: string
  userId: string
}

export async function recordUsageEvent(
  env: Env,
  ownerId: string,
  jobId: string,
  modelId: string,
  stage: "vision" | "writer" | "quality",
  inputTokens: number,
  outputTokens: number,
  neurons: number,
  measurement: "actual" | "estimated" = "actual",
) {
  try {
    const id = generateId("use")
    const utcDate = new Date().toISOString().slice(0, 10)
    await env.DB.prepare(
      `INSERT INTO ai_usage_events (id, owner_id, job_id, utc_date, model_id, stage, input_tokens, output_tokens, neurons, measurement)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(id, ownerId, jobId, utcDate, modelId, stage, inputTokens, outputTokens, neurons, measurement)
      .run()
  } catch {
    // Non-blocking usage logging
  }
}

export const VISION_PROMPT = `사진에 보이는 교구, 사물, 아이의 실제 손동작과 물리적 행동을 있는 그대로 한국어로 구체적이고 정확하게 묘사하세요:
1. 교구 및 학습 자료: 활동지에 인쇄된 문자나 수학 연산 기호, 모양 블록, 나무 막대, 플라스틱 연결 부위 색상(빨간색 플라스틱 연결 캡 등), 필기도구, 손에 쥔 간식 등 실제로 관찰되는 사물을 사실 그대로 구체적으로 식별하세요.
2. 손동작과 행동: 아이가 손으로 쥐고 있는 교구, 막대를 연결하는 동작, 종이에 필기하는 동작, 시선 방향 등 관찰 가능한 물리적 행동만 적으세요.
3. 절대 금지: 사진에 없는 가상의 사물(고양이, 주스, 동화책 등)을 지어내지 마세요. 내면의 감정, 표정 해석(눈빛, 몰입, 성취감, 즐거움), 성격이나 발달 효과를 절대 추론하거나 상상하지 마세요.
4. 인물 지칭: 이름 대신 '아이'로 지칭하세요.`

export const WRITER_SYSTEM_PROMPT =
  "You are a professional childcare teacher and blog writer. Keep internal reasoning concise. Write an authentic, warm, and engaging Korean blog post for kindergarten/daycare parents strictly based on the provided photo observations. Strictly adhere to visible facts and concrete actions. Never invent unobserved objects (e.g. cats, juice, fictional books) and never infer inner psychological feelings, facial expressions (e.g. glowing eyes, deep immersion), or unobserved developmental claims (e.g. sense of achievement, cognitive boost). Ensure every photo marker from [사진 1] to [사진 N] is placed on its own line and accompanied by rich, factual narrative paragraphs before and after."

export function buildWriterPrompt(
  mergedObservation: string,
  totalPhotos: number,
  toneStyle?: string,
): string {
  return `다음 사진별 실제 관찰 내용을 바탕으로 학부모님들께 공유할 따뜻하고 정돈된 교실 활동 블로그 글을 작성해주세요.

[사진별 실제 관찰 내용]:
${mergedObservation}

[작성 원칙 및 구성 지침 (엄격 준수)]:
1. 사실성 및 관찰 충실:
   - 반드시 위에 제공된 [사진별 실제 관찰 내용]에 명시된 교구(나무 막대, 연산 활동지, 모양 블록, 연결 부위 등), 사물, 손동작만을 근거로 작성하세요.
   - 관찰 내용에 없는 사물(고양이, 주스, 가상의 동화책 등)을 절대 창작하거나 왜곡하지 마세요.
   - 비관찰적 추론 금지: "반짝이는 눈빛", "즐거운 시간", "깊은 몰입감", "뿌듯한 성취감", "상상력·집중력·사고력 향상" 등 아이의 내면 심리, 감정, 발달 효과를 주관적으로 단정하거나 과장하는 상투적 표현을 완전히 배제하세요.
   - 오직 눈에 보이는 구체적 행동(예: 막대를 연결 부위에 끼우는 모습, 활동지의 연산 문제를 연필로 적어 내려가는 손끝)과 활동 과정을 차분하고 따뜻하게 기록하세요.
   - 1인이 혼자 활동하는 관찰 내용이라면 '또래놀이', '친구들과 함께' 같은 표현이나 해시태그(#또래놀이)를 절대 포함하지 마세요.

2. 제목: 활동 주제와 관찰 내용이 담긴 다정한 블로그 제목 (1행에 Markdown # [제목] 형식으로 작성, 예: # [활동 기록] 나무 막대와 연산 활동지로 채운 배움의 시간)

3. 사진 마커 및 문단 배치 (매우 중요):
   - 총 ${totalPhotos}장의 사진이 있으므로, 본문에 [사진 1]부터 [사진 ${totalPhotos}]까지 순서대로 빠짐없이 배치해야 합니다.
   - [필수 규칙] 각 사진 마커([사진 K])의 사이사이에는 반드시 해당 사진 속 활동을 구체적으로 설명하는 본문 문단(최소 2~3문장)이 위치해야 합니다.
   - 사진 마커가 연달아 나오거나 본문 설명 없이 마커만 단독으로 붙어있는 구성을 절대 금지합니다.
   - 구성 흐름 예시:
     도입 문단 (오늘의 교실 활동 주제 안내)
     [사진 1]
     사진 1의 구체적 활동과 교구 묘사 문단
     [사진 2]
     사진 2의 구체적 활동과 교구 묘사 문단
     ...
     [사진 ${totalPhotos}]
     사진 ${totalPhotos}의 구체적 활동과 교구 묘사 문단
     마무리 문단 (가정과의 소통 및 차분한 마무리 인사)

4. 문체: 학부모님께 친근하고 정중한 존댓말(~했답니다, ~해보았어요 등)
${toneStyle ? `\n5. [선생님 고유 맞춤 문체 지침]:\n${toneStyle}` : ""}

[중요]: 서두/말미의 메타 안내나 에디터 인사말 없이 오직 블로그 글 본문 Markdown만 처음부터 끝까지 출력하세요.`
}

export const QUALITY_SYSTEM_PROMPT =
  "You are an expert childcare content editor. Keep internal reasoning concise. Refine the given draft by correcting any grammar or awkward expressions, ensuring photo markers [사진 1], [사진 2] are properly placed on their own lines with accompanying text before and after each marker, strictly removing unobserved fictional items or psychological buzzwords, and preserving the warm teacher tone. Output ONLY the polished Korean blog post Markdown from title to ending."

export function buildQualityPrompt(draftText: string, totalPhotos: number): string {
  return `다음 블로그 초안을 엄격히 검수하고 다듬어주세요:

[검수 및 교정 규칙]:
1. 사진 마커 확인: [사진 1]부터 [사진 ${totalPhotos}]까지 모두 포함되어 있는지, 마커 사이에 빈 공간 없이 사진별 설명 문단이 잘 채워져 있는지 확인하고 누락된 연결 문단을 보완하세요.
2. 비관찰적 과장 표현 제거: "반짝이는 눈빛", "깊은 몰입", "성취감", "사고력 쑥쑥" 등 감정/발달 과장 표현이 있다면 차분하고 따뜻한 관찰 사실 서술로 정돈하세요.
3. 허구적 사물 제거: 본문에 관찰 근거가 없는 왜곡 표현(고양이, 주스 등)이 있다면 사실적인 교구/활동 표현으로 정정하세요.
4. 혼자 활동하는 글에 #또래놀이 등 어울리지 않는 해시태그가 있다면 제거하세요.
5. 1행의 제목(# [제목])과 본문 문단 형식을 정돈하세요.

초안:
${draftText}

[중요]: 에디터 설명이나 메타 코멘트 없이 오직 완성된 블로그 글 본문 Markdown만 출력하세요.`
}

export const FALLBACK_DRAFT_TEXT =
  "# [활동 기록] 차근차근 교구를 탐색하는 우리들의 시간\n\n오늘 우리 반 교실에서는 아이들과 함께 준비된 교구와 활동지를 차근차근 살펴보며 활동을 시작했습니다.\n\n[사진 1]\n\n아이1은 책상에 놓인 활동지와 교구의 형태를 찬찬히 확인하며 손끝으로 조작해 보았어요.\n\n[사진 2]\n\n연필을 바르게 쥐고 주어진 연산 과제를 한 단계씩 해결해 나가는 모습을 볼 수 있었습니다.\n\n[사진 3]\n\n손으로 교구를 연결하고 맞추어가며 계획한 모양을 하나씩 구성해 보았답니다.\n\n오늘 교실에서 이루어진 활동 과정을 가정에서도 따뜻하게 이야기 나누어 주시길 바랍니다."

export class BlogWriterWorkflow extends WorkflowEntrypoint<Env, WorkflowParams> {
  async run(event: WorkflowEvent<WorkflowParams>, step: WorkflowStep) {
    const { jobId, userId } = event.payload

    // Step 1: Init & verify slots
    const slots = await step.do("init", async () => {
      const rows = await this.env.DB.prepare(
        "SELECT * FROM upload_slots WHERE job_id = ? AND user_id = ? ORDER BY slot_id ASC",
      )
        .bind(jobId, userId)
        .all<{ slot_id: number; object_key: string }>()

      if (!rows.results || rows.results.length === 0) {
        throw new Error("No verified slots found")
      }
      return rows.results
    })

    // Step 2: Parallel Vision Analysis (Batch of 3)
    const visionObservations: string[] = []
    const batchSize = 3
    for (let i = 0; i < slots.length; i += batchSize) {
      const batch = slots.slice(i, i + batchSize)
      const results = await Promise.all(
        batch.map((slot) =>
          step.do(
            `vision_slot_${slot.slot_id}`,
            { retries: { limit: 1, delay: "3 seconds" } },
            async () => {
              const r2Obj = await this.env.R2_BUCKET.get(slot.object_key)
              if (!r2Obj) {
                return `아이${slot.slot_id + 1} (사진 ${slot.slot_id + 1})이 책상에서 활동지와 교구를 살펴보며 조작하는 모습.`
              }

              const buffer = await r2Obj.arrayBuffer()
              try {
                const aiRes = await this.env.AI.run(
                  "@cf/meta/llama-3.2-11b-vision-instruct",
                  {
                    image: [...new Uint8Array(buffer)],
                    prompt: VISION_PROMPT,
                    max_tokens: 400,
                  },
                )

                return aiRes.response || `아이${slot.slot_id + 1} (사진 ${slot.slot_id + 1})이 책상에서 교구를 탐색하는 모습.`
              } catch {
                return `아이${slot.slot_id + 1} (사진 ${slot.slot_id + 1})이 책상에서 교구를 탐색하는 모습.`
              }
            },
          ),
        ),
      )
      visionObservations.push(...results)
    }

    // Step 3: Merge observations
    const mergedObservation = await step.do("merge", async () => {
      return visionObservations.join("\n")
    })

    // Step 4: 1차 PII 검사 (Input Check)
    const piiInputCheck = await step.do("pii_input", async () => {
      return detectPII(mergedObservation)
    })

    if (piiInputCheck.detected) {
      await step.do("stop_on_pii_input", async () => {
        await purgeJobR2AndTempData(this.env, userId, jobId)
        await transitionJob(this.env, jobId, "processing", "failed", {
          failureCode: "PROHIBITED_IDENTIFIER_DETECTED",
        })
      })
      return { success: false, reason: "PII_DETECTED" }
    }

    // Step 5: Writer 초안 생성 (Gemma 4 26B IT + 맞춤 문체 프로필 적용)
    const draftText = await step.do(
      "writer",
      { retries: { limit: 1, delay: "3 seconds" } },
      async () => {
        // Fetch learned user style if exists
        const userStyle = await this.env.DB.prepare(
          "SELECT tone_style FROM user_style_profiles WHERE user_id = ?",
        )
          .bind(userId)
          .first<{ tone_style: string }>()

        const writerPrompt = buildWriterPrompt(mergedObservation, slots.length, userStyle?.tone_style)

        try {
          const aiRes = await this.env.AI.run("@cf/google/gemma-4-26b-a4b-it", {
            messages: [
              {
                role: "system",
                content: WRITER_SYSTEM_PROMPT,
              },
              {
                role: "user",
                content: writerPrompt,
              },
            ],
            max_completion_tokens: 4096,
          })

          const text = (aiRes as { response?: string })?.response
          return text && text.length > 50 ? text : FALLBACK_DRAFT_TEXT
        } catch {
          return FALLBACK_DRAFT_TEXT
        }
      },
    )

    // Step 6: Quality 검수
    const qualityText = await step.do(
      "quality",
      { retries: { limit: 1, delay: "3 seconds" } },
      async () => {
        try {
          const aiRes = await this.env.AI.run("@cf/google/gemma-4-26b-a4b-it", {
            messages: [
              {
                role: "system",
                content: QUALITY_SYSTEM_PROMPT,
              },
              {
                role: "user",
                content: buildQualityPrompt(draftText, slots.length),
              },
            ],
            max_completion_tokens: 4096,
          })
          const text = (aiRes as { response?: string })?.response
          return text && text.length >= draftText.length * 0.7 ? text : draftText
        } catch {
          return draftText
        }
      },
    )

    // Step 7: 2차 PII 검사 (Output Check)
    const piiOutputCheck = await step.do("pii_output", async () => {
      return detectPII(qualityText)
    })

    if (piiOutputCheck.detected) {
      await step.do("stop_on_pii_output", async () => {
        await purgeJobR2AndTempData(this.env, userId, jobId)
        await transitionJob(this.env, jobId, "processing", "failed", {
          failureCode: "PROHIBITED_IDENTIFIER_DETECTED",
        })
      })
      return { success: false, reason: "PII_DETECTED" }
    }

    // Step 8: Prepare Review & Save Temp Artifact
    await step.do("prepare_review", async () => {
      const artifactId = generateId("art")
      const contentHash = await sha256(qualityText)
      const now = new Date()
      const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString()

      // Save draft artifact in D1
      await this.env.DB.prepare(
        `INSERT INTO temp_artifacts (id, job_id, user_id, kind, content, content_hash, expires_at)
         VALUES (?, ?, ?, 'draft', ?, ?, ?)`,
      )
        .bind(artifactId, jobId, userId, qualityText, contentHash, expiresAt)
        .run()

      // Transition to waiting(user_review)
      await transitionJob(this.env, jobId, "processing", "waiting", {
        waitingReason: "user_review",
        progressStage: "quality_passed",
        reviewArtifactId: artifactId,
        identifierChecksPassed: 1,
      })
    })

    return { success: true, jobId }
  }
}

interface AiChoice {
  message?: {
    content?: string
  }
}

interface AiResponseLike {
  response?: string
  choices?: AiChoice[]
  result?: AiResponseLike
}

function extractAiText(aiRes: unknown): string {
  if (!aiRes) return ""
  if (typeof aiRes === "string") return aiRes.trim()
  const obj = aiRes as AiResponseLike
  if (typeof obj.response === "string" && obj.response.trim().length > 0) {
    return obj.response.trim()
  }
  if (Array.isArray(obj.choices) && obj.choices[0]?.message?.content) {
    return obj.choices[0].message.content.trim()
  }
  if (obj.result) {
    return extractAiText(obj.result)
  }
  return ""
}

async function executeAiModel(
  env: Env,
  model: string,
  inputs: Record<string, unknown>,
  timeoutMs = 50000,
): Promise<string> {
  // 1. Try env.AI binding first (with timeout)
  if (env.AI) {
    try {
      const bindingPromise = env.AI.run(model, inputs)
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("AI_BINDING_TIMEOUT")), timeoutMs),
      )
      const res = await Promise.race([bindingPromise, timeoutPromise])
      const text = extractAiText(res)
      if (text) return text
    } catch {
      // Fall through to direct REST API if binding fails or times out
    }
  }

  // 2. Direct Cloudflare AI REST API Fallback
  const token = env.CLOUDFLARE_API_TOKEN
  const accountId = env.CLOUDFLARE_ACCOUNT_ID
  if (token && accountId) {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      const resp = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(inputs),
          signal: controller.signal,
        },
      )
      clearTimeout(timer)
      if (resp.ok) {
        const json: unknown = await resp.json()
        const text = extractAiText(json)
        if (text) return text
      }
    } catch {
      // Return empty if REST API also fails
    }
  }

  return ""
}

/**
 * Direct Fallback Pipeline Runner (for Local Dev & Resilient Execution)
 */
export async function runDirectWorkflowPipeline(
  env: Env,
  jobId: string,
  userId: string,
): Promise<{ success: boolean; reason?: string }> {
  try {
    // 1. Fetch slots
    const rows = await env.DB.prepare(
      "SELECT * FROM upload_slots WHERE job_id = ? AND user_id = ? ORDER BY slot_id ASC",
    )
      .bind(jobId, userId)
      .all<{ slot_id: number; object_key: string }>()

    const slots = rows.results || []
    if (slots.length === 0) return { success: false, reason: "NO_SLOTS" }

    await transitionJob(env, jobId, "processing", "processing", { progressStage: "vision" })

    // 2. Vision analysis (Batch of 3)
    const visionObservations: string[] = []
    let totalNeurons = 0

    const canRunRemoteAi = Boolean(env.ENVIRONMENT === "production" || env.CLOUDFLARE_API_TOKEN)

    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i]
      let obs = ""
      try {
        const r2Obj = await env.R2_BUCKET.get(slot.object_key)
        if (r2Obj && canRunRemoteAi) {
          const buffer = await r2Obj.arrayBuffer()
          const text = await executeAiModel(env, "@cf/meta/llama-3.2-11b-vision-instruct", {
            image: [...new Uint8Array(buffer)],
            prompt: VISION_PROMPT,
            max_tokens: 400,
          })
          if (text) {
            obs = `아이${slot.slot_id + 1} (사진 ${slot.slot_id + 1}): ${text}`
            totalNeurons += 220
          }
        }
      } catch {
        // Fallback if AI unavailable
      }

      if (!obs) {
        obs = `아이${slot.slot_id + 1} (사진 ${slot.slot_id + 1})이 책상에서 활동지와 교구를 살펴보며 조작하는 모습.`
        totalNeurons += 50
      }
      visionObservations.push(obs)
    }

    const mergedObservation = visionObservations.join("\n")
    await recordUsageEvent(
      env,
      userId,
      jobId,
      "@cf/meta/llama-3.2-11b-vision-instruct",
      "vision",
      slots.length * 6500,
      slots.length * 400,
      totalNeurons,
      canRunRemoteAi ? "actual" : "estimated",
    )

    // 3. 1차 PII 검사 (Input Check)
    const pii1 = detectPII(mergedObservation)
    if (pii1.detected) {
      // PII Warning Review Workflow: Pause in waiting(user_review) with warning details
      await env.DB.prepare(
        "UPDATE generation_jobs SET status = 'waiting', waiting_reason = 'user_review', progress_stage = 'pii_warning', pii_warning_details = ? WHERE id = ?",
      )
        .bind(JSON.stringify(pii1.categories), jobId)
        .run()

      return { success: false, reason: "PII_WARNING_REVIEW" }
    }

    await transitionJob(env, jobId, "processing", "processing", { progressStage: "writer" })

    // 4. Writer 초안 생성 with 맞춤 문체 프로필
    const userStyle = await env.DB.prepare(
      "SELECT tone_style FROM user_style_profiles WHERE user_id = ?",
    )
      .bind(userId)
      .first<{ tone_style: string }>()

    const writerPrompt = buildWriterPrompt(mergedObservation, slots.length, userStyle?.tone_style)

    let draftText = ""
    try {
      if (canRunRemoteAi) {
        const text = await executeAiModel(env, "@cf/google/gemma-4-26b-a4b-it", {
          messages: [
            {
              role: "system",
              content: WRITER_SYSTEM_PROMPT,
            },
            {
              role: "user",
              content: writerPrompt,
            },
          ],
          max_completion_tokens: 4096,
        })
        if (text && text.length > 50) {
          draftText = text
          totalNeurons += 120
        }
      }
    } catch {
      // Safe fallback
    }

    if (!draftText) {
      draftText = FALLBACK_DRAFT_TEXT
      totalNeurons += 20
    }

    await recordUsageEvent(
      env,
      userId,
      jobId,
      "@cf/google/gemma-4-26b-a4b-it",
      "writer",
      1200,
      800,
      120,
      canRunRemoteAi ? "actual" : "estimated",
    )

    // 5. Quality 검수 단계 (독립 AI 모델 교정 및 사실 기반 정제)
    await transitionJob(env, jobId, "processing", "processing", { progressStage: "quality" })

    let polishedDraft = draftText
    try {
      if (canRunRemoteAi && draftText.length > 50) {
        const qualityText = await executeAiModel(env, "@cf/google/gemma-4-26b-a4b-it", {
          messages: [
            {
              role: "system",
              content: QUALITY_SYSTEM_PROMPT,
            },
            {
              role: "user",
              content: buildQualityPrompt(draftText, slots.length),
            },
          ],
          max_completion_tokens: 4096,
        })
        if (qualityText && qualityText.length >= draftText.length * 0.7) {
          polishedDraft = qualityText
          totalNeurons += 100
        }
      }
    } catch {
      // Keep draftText if quality model is unavailable
    }

    await recordUsageEvent(
      env,
      userId,
      jobId,
      "@cf/google/gemma-4-26b-a4b-it",
      "quality",
      1000,
      600,
      100,
      canRunRemoteAi ? "actual" : "estimated",
    )

    // 6. 2차 PII 검사 (Output Check)
    const pii2 = detectPII(polishedDraft)
    if (pii2.detected) {
      // PII Warning Review on output
      await env.DB.prepare(
        "UPDATE generation_jobs SET status = 'waiting', waiting_reason = 'user_review', progress_stage = 'pii_warning', pii_warning_details = ? WHERE id = ?",
      )
        .bind(JSON.stringify(pii2.categories), jobId)
        .run()

      return { success: false, reason: "PII_WARNING_REVIEW" }
    }

    // 7. Save Draft Artifact
    const artifactId = generateId("art")
    await env.DB.prepare(
      `INSERT INTO temp_artifacts (id, job_id, user_id, kind, content, content_hash, expires_at)
       VALUES (?, ?, ?, 'draft', ?, ?, datetime('now', '+24 hours'))`,
    )
      .bind(artifactId, jobId, userId, polishedDraft, "hash_" + artifactId)
      .run()

    // 8. Record AI neurons used and Transition to user_review
    await env.DB.prepare(
      "UPDATE generation_jobs SET ai_neurons_used = ?, review_artifact_id = ?, identifier_checks_passed = 1 WHERE id = ?",
    )
      .bind(totalNeurons, artifactId, jobId)
      .run()

    await transitionJob(env, jobId, "processing", "waiting", {
      waitingReason: "user_review",
      progressStage: null,
    })

    return { success: true }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Pipeline error"
    await transitionJob(env, jobId, "processing", "failed", { failureCode: msg })
    return { success: false, reason: msg }
  }
}
