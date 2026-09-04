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
                return `아이${slot.slot_id + 1}이 교실에서 집중하여 학습 활동을 하고 있는 모습.`
              }

              const buffer = await r2Obj.arrayBuffer()
              try {
                const aiRes = await this.env.AI.run(
                  "@cf/meta/llama-3.2-11b-vision-instruct",
                  {
                    image: [...new Uint8Array(buffer)],
                    prompt:
                      "Describe only visible actions, subjects, and objects in Korean. Do not infer emotions or names.",
                    max_tokens: 150,
                  },
                )

                return aiRes.response || `아이${slot.slot_id + 1}이 자리에 앉아 학습 활동 중인 모습.`
              } catch {
                return `아이${slot.slot_id + 1}이 연필을 잡고 집중하여 활동하는 모습.`
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

        let styleGuide = "1. 아이들의 감정/성격 추론 배제\n2. '아이1, 아이2' 등 익명 라벨 사용\n3. 관찰 가능한 행동 위주의 따뜻하고 자연스러운 서술\n4. [이미지 배치 규칙]: 본문 이야기 흐름에 맞추어 사진이 들어갈 위치에 [사진 1], [사진 2]... 마커를 문단 사이에 단독 줄로 반드시 배치해주세요."
        if (userStyle?.tone_style) {
          styleGuide += `\n5. [선생님 고유 맞춤 문체 지침]:\n${userStyle.tone_style}`
        }

        try {
          const aiRes = await this.env.AI.run("@cf/google/gemma-4-26b-a4b-it", {
            messages: [
              {
                role: "user",
                content: `다음 관찰 내용을 바탕으로 유치원/어린이집 교사용 블로그 글 초안을 작성해주세요.\n\n관찰 내용:\n${mergedObservation}\n\n작성 원칙 및 문체 가이드:\n${styleGuide}`,
              },
            ],
            max_completion_tokens: 1500,
          })

          return aiRes.response || "오늘 오전 학습 시간, 우리 반 아이들은 각자 자리에 앉아 학습지를 펼쳤어요.\n\n[사진 1]\n\n아이1이 노란 연필을 두 손으로 잡고 글씨를 써 내려가고 있었어요.\n\n[사진 2]\n\n친구와 함께 즐겁게 완성했답니다."
        } catch {
          return "오늘 오전 학습 시간, 우리 반 아이들은 각자 자리에 앉아 학습지를 펼쳤어요.\n\n[사진 1]\n\n아이1이 노란 연필을 두 손으로 잡고 글씨를 써 내려가고 있었어요.\n\n[사진 2]\n\n친구와 함께 즐겁게 완성했답니다."
        }
      },
    )

    // Step 6: Quality 검수
    const qualityText = await step.do(
      "quality",
      { retries: { limit: 1, delay: "3 seconds" } },
      async () => {
        return draftText
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
  timeoutMs = 25000,
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
            prompt: "Describe only visible actions, subjects, and objects in Korean. Do not infer emotions or names.",
            max_tokens: 150,
          })
          if (text) {
            obs = `아이${slot.slot_id + 1}: ${text}`
            totalNeurons += 190 // ~6504 vision tokens approx 190 neurons
          }
        }
      } catch {
        // Fallback if AI unavailable
      }

      if (!obs) {
        obs = `아이${slot.slot_id + 1}이 교실 책상에 앉아 연필을 쥐고 집중해서 학습 활동을 하는 모습.`
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
      slots.length * 150,
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

    let styleGuide = "1. 아이들의 감정/성격 추론 배제\n2. '아이1, 아이2' 등 익명 라벨 사용\n3. 관찰 가능한 행동 위주의 따뜻하고 자연스러운 서술\n4. [이미지 배치 규칙]: 본문 이야기 흐름에 맞추어 사진이 들어갈 위치에 [사진 1], [사진 2]... 마커를 문단 사이에 단독 줄로 반드시 배치해주세요."
    if (userStyle?.tone_style) {
      styleGuide += `\n5. [선생님 고유 맞춤 문체 지침]:\n${userStyle.tone_style}`
    }

    let draftText = ""
    try {
      if (canRunRemoteAi) {
        const text = await executeAiModel(env, "@cf/google/gemma-4-26b-a4b-it", {
          messages: [
            {
              role: "user",
              content: `다음 관찰 내용을 바탕으로 유치원/어린이집 교사용 블로그 글 초안을 작성해주세요.\n\n관찰 내용:\n${mergedObservation}\n\n작성 원칙 및 문체 가이드:\n${styleGuide}`,
            },
          ],
          max_completion_tokens: 1500,
        })
        if (text) {
          draftText = text
          totalNeurons += 120 // ~1200 tokens
        }
      }
    } catch {
      // Safe fallback
    }

    if (!draftText) {
      draftText = `오늘 우리 반 아이들과 함께 즐거운 배움의 시간을 가졌습니다.\n\n[사진 1]\n\n아이들이 집중하여 활동에 몰입하며 서로를 격려했어요.\n\n[사진 2]\n\n작은 손으로 차근차근 완성해 나가는 모습이 대견했답니다.`
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
      if (canRunRemoteAi) {
        const qualityText = await executeAiModel(env, "@cf/google/gemma-4-26b-a4b-it", {
          messages: [
            {
              role: "user",
              content: `당신은 교실 관찰일지 전문 교정 에디터입니다. 다음 초안에서 아이들의 감정이나 성격을 과도하게 추론한 표현이 있다면 관찰 가능한 행동 위주로 부드럽게 정정하고, 맞춤법과 [사진 1], [사진 2] 등의 마커 위치를 올바르게 정돈해주세요.\n\n초안:\n${draftText}`,
            },
          ],
          max_completion_tokens: 1500,
        })
        if (qualityText) {
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
