/**
 * blog_writer Cloudflare Worker Entry Point & REST API Router
 * Production Hardened Implementation conforming to TECH-DESIGN v2.3
 */

import { Env } from "./types/env.js"
import { BlogWriterWorkflow, runDirectWorkflowPipeline, recordUsageEvent } from "./workflow.js"
import { detectPII } from "./services/piiService.js"
import {
  createJobWithSlots,
  getOwnedJob,
  transitionJob,
  finalizeJobByUser,
  purgeJobR2AndTempData,
  purgeExpiredPhotos,
  purgeExpiredTempArtifacts,
  retryPendingCleanup,
  purgeExpiredJobs,
} from "./services/jobService.js"
import { inspectImageBytes } from "./services/imageService.js"
import {
  getUserStyleProfile,
  learnUserStyle,
  learnUserStyleFromUrl,
  deleteUserStyleProfile,
} from "./services/styleService.js"
import { sha256 } from "./utils/crypto.js"
import { verifyAuthToken } from "./utils/firebaseAuth.js"
import { TempArtifact, Post, UserSettings } from "./types/job.js"

export { BlogWriterWorkflow }

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
      "access-control-allow-headers": "Content-Type, Authorization",
    },
  })
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
          "access-control-allow-headers": "Content-Type, Authorization, X-Owner-Id",
        },
      })
    }

    const url = new URL(request.url)
    const pathname = url.pathname

    // 0. Serve Static Assets (HTML, CSS, JS from public directory)
    if (!pathname.startsWith("/api/")) {
      if (pathname === "/favicon.ico") {
        return new Response(null, { status: 204 })
      }
      if (env.ASSETS) {
        try {
          const assetRes = await env.ASSETS.fetch(request)
          if (assetRes.status < 400) return assetRes
        } catch {
          // Fall through
        }
      }
      return new Response("Not Found", { status: 404 })
    }

    // 1. Health check (Public Whitelist)
    if (pathname === "/api/health") {
      return jsonResponse({
        status: "healthy",
        project: "blog_writer",
        version: "3.0",
        timestamp: new Date().toISOString(),
      })
    }

    // 2. Personal Authentication & Token Verification Endpoint
    if (pathname === "/api/auth/login" && request.method === "POST") {
      const body = (await request.json().catch(() => ({}))) as { token?: string; pin?: string }
      const candidateToken = body.token || body.pin || ""
      const dummyReq = new Request("https://localhost/api/auth/verify", {
        headers: { Authorization: `Bearer ${candidateToken}` },
      })
      const authCheck = await verifyAuthToken(dummyReq, env)
      if (authCheck.valid) {
        return jsonResponse({
          success: true,
          token: candidateToken,
          userId: authCheck.userId,
          message: "소유자 개인 인증에 성공했습니다.",
        })
      }
      return jsonResponse(
        {
          error: authCheck.status === 403 ? "FORBIDDEN_NOT_IN_ALLOWLIST" : "UNAUTHORIZED",
          message: authCheck.error || "인증 토큰이 유효하지 않습니다.",
        },
        authCheck.status,
      )
    }

    // 3. Strict Authentication Guard on all protected /api/* endpoints
    const auth = await verifyAuthToken(request, env)
    if (!auth.valid) {
      console.warn(`[Auth Guard Rejected] ${request.method} ${pathname} -> ${auth.status}: ${auth.error}`)
      return jsonResponse(
        {
          error: auth.status === 403 ? "FORBIDDEN_NOT_IN_ALLOWLIST" : "UNAUTHORIZED",
          message: auth.error || "개인 접근 권한이 없습니다. 상단 또는 인증 창에서 유효한 인증 토큰을 입력해주세요.",
        },
        auth.status,
      )
    }
    const userId = auth.userId!

    try {
      // 4. GET /api/posts - List Completed Posts
      if (pathname === "/api/posts" && request.method === "GET") {
        const posts = await env.DB.prepare(
          "SELECT id, job_id, user_id, title, summary, r2_markdown_key, tags, visibility, created_at FROM posts WHERE user_id = ? AND visibility = 'published' ORDER BY created_at DESC",
        )
          .bind(userId)
          .all<Post>()

        return jsonResponse({ posts: posts.results })
      }

      // 4-1. GET /api/posts/:id/content - Stream Markdown Content from R2 and Photo URLs
      const postContentMatch = pathname.match(/^\/api\/posts\/([^/]+)\/content$/)
      if (postContentMatch && request.method === "GET") {
        const postId = postContentMatch[1]
        const post = await env.DB.prepare("SELECT * FROM posts WHERE id = ? AND user_id = ?")
          .bind(postId, userId)
          .first<Post>()

        if (!post) {
          return jsonResponse({ error: "게시글을 찾을 수 없습니다." }, 404)
        }

        // List photos for this post
        const photoPrefix = `users/${userId}/posts/${postId}/photos/`
        const photoList = await env.R2_BUCKET.list({ prefix: photoPrefix })
        const photos = (photoList.objects || [])
          .map((obj) => {
            const match = obj.key.match(/photo_(\d+)\.webp$/)
            return {
              slotId: match ? parseInt(match[1], 10) : 0,
              url: `/api/posts/${postId}/photos/${match ? match[1] : 0}`,
            }
          })
          .sort((a, b) => a.slotId - b.slotId)
          .map((p) => p.url)

        let mdText = post.content || ""
        if (post.r2_markdown_key) {
          const r2Obj = await env.R2_BUCKET.get(post.r2_markdown_key)
          if (r2Obj) {
            mdText = await r2Obj.text()
          }
        }

        return jsonResponse({
          id: postId,
          title: post.title,
          content: mdText,
          photos,
        })
      }

      // 4-2. GET /api/posts/:id/photos/:slotId - Stream Published Post Photo from R2
      const postPhotoMatch = pathname.match(/^\/api\/posts\/([^/]+)\/photos\/(\d+)$/)
      if (postPhotoMatch && request.method === "GET") {
        const postId = postPhotoMatch[1]
        const slotId = postPhotoMatch[2]
        const post = await env.DB.prepare("SELECT id FROM posts WHERE id = ? AND user_id = ?")
          .bind(postId, userId)
          .first<{ id: string }>()

        if (!post) {
          return jsonResponse({ error: "게시글을 찾을 수 없습니다." }, 404)
        }

        const photoKey = `users/${userId}/posts/${postId}/photos/photo_${slotId}.webp`
        const r2Obj = await env.R2_BUCKET.get(photoKey)
        if (!r2Obj) {
          return jsonResponse({ error: "사진을 찾을 수 없습니다." }, 404)
        }

        return new Response(r2Obj.body, {
          status: 200,
          headers: {
            "content-type": "image/webp",
            "cache-control": "private, max-age=86400",
            "access-control-allow-origin": "*",
          },
        })
      }

      // 4-3. DELETE /api/posts/:id - Delete Published Post (Markdown & Photos)
      const postDeleteMatch = pathname.match(/^\/api\/posts\/([^/]+)$/)
      if (postDeleteMatch && (request.method === "DELETE" || request.method === "POST")) {
        const postId = postDeleteMatch[1]
        const post = await env.DB.prepare("SELECT id, r2_markdown_key FROM posts WHERE id = ? AND user_id = ?")
          .bind(postId, userId)
          .first<{ id: string; r2_markdown_key: string }>()

        if (post) {
          if (post.r2_markdown_key) {
            await env.R2_BUCKET.delete(post.r2_markdown_key)
          }
          const postPrefix = `users/${userId}/posts/${postId}/`
          const listed = await env.R2_BUCKET.list({ prefix: postPrefix })
          for (const obj of listed.objects || []) {
            await env.R2_BUCKET.delete(obj.key)
          }
          await env.DB.prepare("DELETE FROM posts WHERE id = ? AND user_id = ?")
            .bind(postId, userId)
            .run()
        }

        return jsonResponse({ success: true, id: postId }, 200)
      }

      // 5. POST /api/styles/learn - Learn Style from Previous Posts
      if (pathname === "/api/styles/learn" && request.method === "POST") {
        const body = (await request.json().catch(() => ({}))) as { limit?: number }
        const limit = body.limit ?? 5
        const result = await learnUserStyle(env, userId, limit)
        return jsonResponse(result, 200)
      }

      // 5-1. POST /api/styles/learn-url - Learn Style from Blog Post URL
      if (pathname === "/api/styles/learn-url" && request.method === "POST") {
        const body = (await request.json()) as { url?: string }
        if (!body.url || typeof body.url !== "string") {
          return jsonResponse({ error: "학습할 블로그 글의 URL 링크를 입력해주세요." }, 400)
        }
        const result = await learnUserStyleFromUrl(env, userId, body.url.trim())
        return jsonResponse(result, 200)
      }

      // 5-2. GET /api/styles/profile - Get Learned Style Profile
      if (pathname === "/api/styles/profile" && request.method === "GET") {
        const profile = await getUserStyleProfile(env, userId)
        return jsonResponse({ profile: profile || { message: "학습된 문체 프로필이 없습니다." } })
      }

      // 5-3. DELETE /api/styles/profile - Delete Learned Style Profile
      if (pathname === "/api/styles/profile" && (request.method === "DELETE" || request.method === "POST")) {
        const result = await deleteUserStyleProfile(env, userId)
        return jsonResponse(result, 200)
      }

      // 6. GET /api/settings - Query Actual Persistent Settings
      if (pathname === "/api/settings" && request.method === "GET") {
        const [jobStats, postStats, slotStats, styleProfile, userSettingsRow, neuronSum] = await Promise.all([
          env.DB.prepare("SELECT count(*) as count FROM generation_jobs WHERE user_id = ?").bind(userId).first<{ count: number }>(),
          env.DB.prepare("SELECT count(*) as count FROM posts WHERE user_id = ?").bind(userId).first<{ count: number }>(),
          env.DB.prepare("SELECT count(*) as count FROM upload_slots WHERE user_id = ?").bind(userId).first<{ count: number }>(),
          getUserStyleProfile(env, userId),
          env.DB.prepare("SELECT settings_json FROM user_settings WHERE user_id = ?").bind(userId).first<UserSettings>(),
          env.DB.prepare("SELECT sum(ai_neurons_used) as total_neurons FROM generation_jobs WHERE user_id = ?").bind(userId).first<{ total_neurons: number }>(),
        ])

        let savedSettings = {}
        if (userSettingsRow?.settings_json) {
          try {
            savedSettings = JSON.parse(userSettingsRow.settings_json)
          } catch {
            // ignore
          }
        }

        const defaultSettings = {
          environment: env.ENVIRONMENT || "development",
          maxImageBytes: env.MAX_IMAGE_BYTES || 10485760,
          expirationHours: env.EXPIRATION_HOURS || 24,
          visionModel: "@cf/meta/llama-3.2-11b-vision-instruct",
          writerModel: "@cf/google/gemma-4-26b-a4b-it",
          maxTokens: 1500,
          parallelVisionSlots: 3,
          zeroRetention: true,
          piiRules: [
            { id: "korean_rrn", name: "주민등록번호", active: true },
            { id: "phone_number", name: "휴대전화번호", active: true },
            { id: "email_address", name: "이메일 주소", active: true },
            { id: "credit_card", name: "신용카드번호", active: true },
            { id: "passport_kr", name: "여권번호", active: true },
            { id: "drivers_license_kr", name: "운전면허번호", active: true },
          ],
        }

        return jsonResponse({
          settings: { ...defaultSettings, ...savedSettings },
          stats: {
            totalJobs: jobStats?.count ?? 0,
            totalPosts: postStats?.count ?? 0,
            totalSlots: slotStats?.count ?? 0,
            hasStyleProfile: Boolean(styleProfile?.tone_style),
            styleProfileCount: styleProfile?.learned_post_count ?? 0,
            totalNeuronsUsed: neuronSum?.total_neurons ?? 0,
            dailyNeuronsQuota: 10000,
            r2BucketName: "blog-writer-photos",
            d1DatabaseName: "blog-writer-db",
          },
        })
      }

      // 6-1. POST / PUT /api/settings - Strict Allowlist & Range Validation D1 user_settings
      if (pathname === "/api/settings" && (request.method === "POST" || request.method === "PUT")) {
        const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
        const allowedKeys = new Set([
          "retentionHours",
          "expirationHours",
          "maxImageBytes",
          "visionModel",
          "writerModel",
          "qualityModel",
          "maxOutputTokens",
          "parallelVisionSlots",
        ])

        // 1. Unknown keys check
        for (const key of Object.keys(body)) {
          if (!allowedKeys.has(key)) {
            return jsonResponse(
              { error: "INVALID_SETTING_KEY", message: `허용되지 않은 설정 항목입니다: '${key}'` },
              400,
            )
          }
        }

        // 2. Range & Type Validation
        if ("retentionHours" in body || "expirationHours" in body) {
          const val = Number(body.retentionHours ?? body.expirationHours)
          if (!Number.isInteger(val) || val < 1 || val > 72) {
            return jsonResponse(
              { error: "INVALID_RANGE", message: "보관 시간(retentionHours)은 1~72시간 사이의 정수여야 합니다." },
              400,
            )
          }
        }

        if ("maxImageBytes" in body) {
          const val = Number(body.maxImageBytes)
          if (!Number.isInteger(val) || val < 1048576 || val > 20971520) {
            return jsonResponse(
              { error: "INVALID_RANGE", message: "최대 사진 용량은 1MB(1048576) ~ 20MB(20971520) 사이여야 합니다." },
              400,
            )
          }
        }

        if ("maxOutputTokens" in body) {
          const val = Number(body.maxOutputTokens)
          if (!Number.isInteger(val) || val < 256 || val > 4096) {
            return jsonResponse(
              { error: "INVALID_RANGE", message: "최대 출력 토큰은 256 ~ 4096 사이의 정수여야 합니다." },
              400,
            )
          }
        }

        if ("parallelVisionSlots" in body) {
          const val = Number(body.parallelVisionSlots)
          if (![1, 2, 3].includes(val)) {
            return jsonResponse(
              { error: "INVALID_RANGE", message: "병렬 시각 분석 슬롯은 1, 2, 3 중 하나여야 합니다." },
              400,
            )
          }
        }

        const settingsJson = JSON.stringify(body)

        await env.DB.prepare(
          `INSERT INTO user_settings (user_id, settings_json, updated_at)
           VALUES (?, ?, datetime('now'))
           ON CONFLICT(user_id) DO UPDATE SET
             settings_json = excluded.settings_json,
             updated_at = datetime('now')`,
        )
          .bind(userId, settingsJson)
          .run()

        return jsonResponse({
          success: true,
          message: "환경 설정이 안전하게 저장되었습니다.",
          settings: body,
        })
      }

      // 6-2. GET /api/stats or /api/usage - System & Real Neurons Usage per UTC Date
      if ((pathname === "/api/stats" || pathname === "/api/usage") && request.method === "GET") {
        const queryDate = url.searchParams.get("date") || new Date().toISOString().slice(0, 10)

        // Aggregation per model and stage for specified UTC date
        const usageEvents = await env.DB.prepare(
          `SELECT model_id, stage, sum(input_tokens) as in_tokens, sum(output_tokens) as out_tokens, sum(neurons) as total_neurons, count(*) as call_count
           FROM ai_usage_events
           WHERE owner_id = ? AND utc_date = ?
           GROUP BY model_id, stage`,
        )
          .bind(userId, queryDate)
          .all<{
            model_id: string
            stage: string
            in_tokens: number
            out_tokens: number
            total_neurons: number
            call_count: number
          }>()

        let totalNeuronsDate = 0
        const breakdown = (usageEvents.results || []).map((row) => {
          totalNeuronsDate += row.total_neurons
          return {
            modelId: row.model_id,
            stage: row.stage,
            inputTokens: row.in_tokens,
            outputTokens: row.out_tokens,
            neurons: row.total_neurons,
            calls: row.call_count,
          }
        })

        const [jobStats, postStats, slotStats, styleProfile] = await Promise.all([
          env.DB.prepare("SELECT count(*) as count FROM generation_jobs WHERE user_id = ?").bind(userId).first<{ count: number }>(),
          env.DB.prepare("SELECT count(*) as count FROM posts WHERE user_id = ?").bind(userId).first<{ count: number }>(),
          env.DB.prepare("SELECT count(*) as count FROM upload_slots WHERE user_id = ?").bind(userId).first<{ count: number }>(),
          getUserStyleProfile(env, userId),
        ])

        const dailyQuota = 10000
        const percentUsed = Math.min(100, Math.round((totalNeuronsDate / dailyQuota) * 100))
        let warningLevel: "normal" | "caution" | "warning" = "normal"
        let warningMessage = "일일 무료 사용량이 안정적인 수준입니다."
        if (percentUsed >= 90) {
          warningLevel = "warning"
          warningMessage = "강한 경고: 일일 참고 한도의 90%를 초과했습니다."
        } else if (percentUsed >= 70) {
          warningLevel = "caution"
          warningMessage = "주의: 일일 참고 한도의 70%에 도달했습니다."
        }

        return jsonResponse({
          status: "healthy",
          date: queryDate,
          usage: {
            totalNeurons: totalNeuronsDate,
            dailyQuotaNeurons: dailyQuota,
            percentUsed,
            warningLevel,
            warningMessage,
            disclaimer: "실제 청구와 무료 할당량은 Cloudflare Dashboard가 최종 기준입니다.",
            lastUpdated: new Date().toISOString(),
            breakdown,
          },
          summary: {
            totalJobs: jobStats?.count ?? 0,
            totalPosts: postStats?.count ?? 0,
            totalSlots: slotStats?.count ?? 0,
            hasStyleProfile: Boolean(styleProfile?.tone_style),
            styleProfileCount: styleProfile?.learned_post_count ?? 0,
          },
        })
      }

      // 7. POST /api/jobs - Create Job & Slots
      if (pathname === "/api/jobs" && request.method === "POST") {
        const body = (await request.json()) as { slotCount?: number; idempotencyKey?: string }
        const slotCount = body.slotCount ?? 6
        const idempotencyKey = body.idempotencyKey ?? crypto.randomUUID()

        const { job, slots } = await createJobWithSlots(env, userId, slotCount, idempotencyKey)
        return jsonResponse({ job, slots }, 201)
      }

      // Match /api/jobs/:jobId routes
      const jobMatch = pathname.match(/^\/api\/jobs\/([^/]+)(?:\/(.*))?$/)
      if (jobMatch) {
        const jobId = jobMatch[1]
        const subRoute = jobMatch[2] || ""

        // 8. GET /api/jobs/:id - Get Job Status
        if (!subRoute && request.method === "GET") {
          const job = await getOwnedJob(env, userId, jobId)
          const slots = await env.DB.prepare(
            "SELECT * FROM upload_slots WHERE job_id = ? ORDER BY slot_id ASC",
          )
            .bind(jobId)
            .all()

          return jsonResponse({ job, slots: slots.results })
        }

        // 9. PUT /api/jobs/:id/photos/:slotId - Upload Photo to Slot
        const photoMatch = subRoute.match(/^photos\/(\d+)$/)
        if (photoMatch && request.method === "PUT") {
          const slotId = parseInt(photoMatch[1], 10)
          const job = await getOwnedJob(env, userId, jobId)

          if (job.status !== "waiting" || job.waiting_reason !== "upload") {
            return jsonResponse({ error: "Cannot upload photos in current job state" }, 400)
          }

          const contentType = request.headers.get("Content-Type") || "image/webp"
          const bytes = await request.arrayBuffer()

          const inspection = inspectImageBytes(bytes, contentType)
          if (!inspection.valid) {
            await env.DB.prepare(
              "UPDATE upload_slots SET status = 'failed' WHERE job_id = ? AND slot_id = ?",
            )
              .bind(jobId, slotId)
              .run()

            return jsonResponse({ error: inspection.error || "Image inspection failed" }, 400)
          }

          const objectKey = `users/${userId}/jobs/${jobId}/slot_${slotId}`
          const checksum = await sha256(bytes)

          // Save to R2
          await env.R2_BUCKET.put(objectKey, bytes, {
            httpMetadata: { contentType },
            customMetadata: {
              jobId,
              slotId: String(slotId),
              checksum,
            },
          })

          // Update upload_slots in D1
          await env.DB.prepare(
            `UPDATE upload_slots
             SET content_type = ?, size_bytes = ?, checksum = ?, status = 'verified'
             WHERE job_id = ? AND slot_id = ?`,
          )
            .bind(contentType, bytes.byteLength, checksum, jobId, slotId)
            .run()

          return jsonResponse({ slotId, checksum, status: "verified" })
        }

        // 10. POST /api/jobs/:id/start - Trigger Real Cloudflare Workflow or Fallback
        if (subRoute === "start" && request.method === "POST") {
          const job = await getOwnedJob(env, userId, jobId)
          if (job.status !== "waiting" && job.status !== "reupload_required") {
            return jsonResponse({ error: "Job is already processing or finished" }, 400)
          }

          const unverified = await env.DB.prepare(
            "SELECT count(*) as count FROM upload_slots WHERE job_id = ? AND status != 'verified'",
          )
            .bind(jobId)
            .first<{ count: number }>()

          if (unverified && unverified.count > 0) {
            return jsonResponse({ error: "모든 사진 슬롯의 업로드가 완료되어야 시작할 수 있습니다." }, 400)
          }

          await transitionJob(env, jobId, job.status, "processing", {
            waitingReason: null,
            progressStage: "init",
          })

          // Trigger Workflows instance in production if bound, or run direct pipeline
          let workflowInstanceId = ""
          if (env.ENVIRONMENT === "production" && env.BLOG_WRITER_WORKFLOW) {
            try {
              const instance = await env.BLOG_WRITER_WORKFLOW.create({
                id: `wf-${jobId}`,
                params: { jobId, userId },
              })
              workflowInstanceId = instance.id
            } catch {
              _ctx.waitUntil(runDirectWorkflowPipeline(env, jobId, userId))
            }
          } else {
            _ctx.waitUntil(runDirectWorkflowPipeline(env, jobId, userId))
          }

          return jsonResponse({ status: "processing", jobId, workflowInstanceId })
        }

        // 11. POST /api/jobs/:id/pii-action - PII Review Decision (Mask & Continue VS Cancel & Purge)
        if (subRoute === "pii-action" && request.method === "POST") {
          const body = (await request.json().catch(() => ({}))) as { action?: "mask_and_continue" | "cancel_and_purge" }
          const job = await getOwnedJob(env, userId, jobId)

          if (body.action === "cancel_and_purge") {
            await purgeJobR2AndTempData(env, userId, jobId)
            await transitionJob(env, jobId, job.status, "failed", {
              failureCode: "USER_CANCELLED_PII",
              waitingReason: null,
              progressStage: "cancelled",
            })
            return jsonResponse({ status: "failed", reason: "USER_CANCELLED_PII", message: "작업이 취소되고 사진이 즉시 영구 파기되었습니다." })
          }

          if (body.action === "mask_and_continue") {
            return jsonResponse(
              {
                error: "PII_MASKING_NOT_SUPPORTED",
                message: "실제 사진/본문 마스킹 기능은 준비 중으로 개인정보 보호를 위해 [취소 및 안전 파기]만 허용됩니다.",
              },
              400,
            )
          }

          return jsonResponse({ error: "올바른 PII 검토 액션(mask_and_continue 또는 cancel_and_purge)을 선택해주세요." }, 400)
        }

        // 12. GET /api/jobs/:id/result - Get Draft or PII Warning
        if (subRoute === "result" && request.method === "GET") {
          const job = await getOwnedJob(env, userId, jobId)

          if (job.progress_stage === "pii_warning") {
            let categories = []
            try {
              categories = JSON.parse(job.pii_warning_details || "[]")
            } catch {
              // ignore
            }
            return jsonResponse({
              status: "waiting",
              waitingReason: "user_review",
              piiWarning: true,
              categories,
              message: `사진 또는 관찰 내용에서 식별정보(${categories.join(", ")})가 발견되었습니다. 마스킹 후 계속 진행하시거나 즉시 파기 후 취소하실 수 있습니다.`,
            })
          }

          if (job.failure_code === "PROHIBITED_IDENTIFIER_DETECTED") {
            return jsonResponse({
              status: "failed",
              warning: "이름, 연락처 등 직접 식별정보가 발견되어 작업을 중단했습니다. 임시 데이터는 즉시 영구 파기되었습니다.",
            })
          }

          if (job.status !== "waiting" || job.waiting_reason !== "user_review") {
            return jsonResponse({ error: "Draft result is not ready for review" }, 400)
          }

          const draftArtifact = await env.DB.prepare(
            "SELECT * FROM temp_artifacts WHERE job_id = ? AND kind = 'draft' ORDER BY created_at DESC LIMIT 1",
          )
            .bind(jobId)
            .first<TempArtifact>()

          return jsonResponse({
            jobId,
            status: "ready_for_review",
            draft: draftArtifact?.content || "",
            piiChecksPassed: Boolean(job.identifier_checks_passed),
          })
        }

        // 12-1. POST /api/jobs/:id/suggest-titles - Suggest 3 Titles and Tags from Draft (Strict PII & State Guard)
        if (subRoute === "suggest-titles" && request.method === "POST") {
          const job = await getOwnedJob(env, userId, jobId)
          if (job.status !== "waiting" || job.waiting_reason !== "user_review") {
            return jsonResponse(
              { error: "INVALID_STATE", message: "제목 추천은 작성 검토 대기(user_review) 상태의 작업에서만 요청할 수 있습니다." },
              400,
            )
          }

          const body = (await request.json().catch(() => ({}))) as { content?: string }

          let draftText = body.content || ""
          if (!draftText) {
            const draftArtifact = await env.DB.prepare(
              "SELECT * FROM temp_artifacts WHERE job_id = ? AND kind = 'draft' ORDER BY created_at DESC LIMIT 1",
            )
              .bind(jobId)
              .first<TempArtifact>()
            draftText = draftArtifact?.content || ""
          }

          if (!draftText || draftText.length < 20) {
            return jsonResponse({ error: "제목을 추천받기 위한 충분한 본문 내용이 없습니다." }, 400)
          }

          // 1. Pre-call PII Input Check
          const piiPre = detectPII(draftText)
          if (piiPre.detected) {
            return jsonResponse(
              {
                error: "PII_DETECTED_IN_DRAFT",
                message: `본문에서 개인식별정보(${piiPre.categories.join(", ")})가 발견되어 외부 AI 제목 추천이 차단되었습니다.`,
              },
              400,
            )
          }

          let titles = [
            "함께 만드는 즐거움! 오늘의 따뜻한 관찰 이야기",
            "아이들의 반짝이는 눈빛과 소중한 하루의 순간들",
            "차근차근 배우고 성장하는 우리들의 행복한 시간",
          ]
          let tags = ["#유아관찰", "#놀이활동", "#유치원일상", "#어린이집하루", "#선생님일기"]

          try {
            if (env.AI && env.ENVIRONMENT === "production") {
              const aiRes = await env.AI.run("@cf/google/gemma-4-26b-a4b-it", {
                messages: [
                  {
                    role: "user",
                    content: `당신은 유치원/어린이집 안심 블로그 작가입니다. 다음 글 본문을 바탕으로, [제목 후보 3가지]와 [추천 해시태그 5개]를 JSON으로 생성해주세요.
중요 지침: 원아의 실명, 특정 인물 식별 정보는 절대로 포함하지 마시고, 따뜻하고 자연스러운 익명 표현만 사용해야 합니다.
형식: {"titles": ["제목1", "제목2", "제목3"], "tags": ["#태그1", "#태그2", "#태그3", "#태그4", "#태그5"]}

[본문 요약]
${draftText.slice(0, 1500)}`,
                  },
                ],
                max_completion_tokens: 300,
              })

              if (aiRes.response) {
                const cleanJson = aiRes.response.replace(/```json/gi, "").replace(/```/g, "").trim()
                const parsed = JSON.parse(cleanJson)
                if (Array.isArray(parsed.titles)) {
                  // Post-call PII Check on generated titles
                  titles = parsed.titles
                    .filter((t: string) => typeof t === "string" && !detectPII(t).detected)
                    .slice(0, 3)
                }
                if (Array.isArray(parsed.tags)) {
                  // Post-call PII Check on generated tags
                  tags = parsed.tags
                    .filter((tg: string) => typeof tg === "string" && !detectPII(tg).detected)
                    .slice(0, 8)
                }

                await recordUsageEvent(
                  env,
                  userId,
                  jobId,
                  "@cf/google/gemma-4-26b-a4b-it",
                  "writer",
                  1000,
                  300,
                  40,
                  "actual",
                )
              }
            }
          } catch {
            // Graceful fallback to default title suggestions
          }

          return jsonResponse({ titles, tags })
        }

        // 13. POST /api/jobs/:id/finish - User Explicit Finalization & Zero-Retention
        if (subRoute === "finish" && request.method === "POST") {
          try {
            const { post } = await finalizeJobByUser(env, userId, jobId)
            return jsonResponse({ status: "completed", post, purged: true })
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : "종료 처리 중 오류가 발생했습니다."
            return jsonResponse({ error: msg }, 400)
          }
        }

        // 14. POST /api/jobs/:id/cancel - User Cancel & Immediate Purge
        if (subRoute === "cancel" && request.method === "POST") {
          const job = await getOwnedJob(env, userId, jobId)
          if (job.status === "completed") {
            return jsonResponse({ error: "Cannot cancel a completed job" }, 400)
          }

          await purgeJobR2AndTempData(env, userId, jobId)
          await transitionJob(env, jobId, job.status, "failed", {
            failureCode: "USER_CANCELLED",
            waitingReason: null,
            progressStage: "cancelled",
          })

          return jsonResponse({ status: "failed", reason: "USER_CANCELLED", purged: true })
        }
      }

      return jsonResponse({ error: "Not Found", path: pathname }, 404)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Internal Server Error"
      const status = message.includes("not found") ? 404 : 500
      return jsonResponse({ error: message }, status)
    }
  },

  // 24-Hour Expiration & Residual Cleanup Cron Scheduler
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const now = new Date()
    ctx.waitUntil(purgeExpiredJobs(env, now))
    ctx.waitUntil(purgeExpiredPhotos(env, now))
    ctx.waitUntil(purgeExpiredTempArtifacts(env, now))
    ctx.waitUntil(retryPendingCleanup(env))
  },
}
