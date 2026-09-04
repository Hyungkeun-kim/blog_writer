/**
 * Job & D1 Database Service
 */

import { Env } from "../types/env.js"
import { GenerationJob, JobStatus, UploadSlot, WaitingReason, TempArtifact, Post } from "../types/job.js"
import { generateId } from "../utils/crypto.js"

export const ALLOWED_TRANSITIONS: Record<JobStatus, Set<JobStatus>> = {
  waiting: new Set(["processing", "reupload_required", "completed", "failed"]),
  processing: new Set(["waiting", "reupload_required", "failed"]),
  reupload_required: new Set(["waiting", "failed"]),
  completed: new Set(),
  failed: new Set(),
}

export async function createJobWithSlots(
  env: Env,
  userId: string,
  slotCount: number,
  idempotencyKey: string,
): Promise<{ job: GenerationJob; slots: UploadSlot[] }> {
  if (slotCount < 3 || slotCount > 20) {
    throw new Error("slotCount must be between 3 and 20")
  }

  // Idempotency check
  const existingJob = await env.DB.prepare(
    "SELECT * FROM generation_jobs WHERE user_id = ? AND idempotency_key = ?",
  )
    .bind(userId, idempotencyKey)
    .first<GenerationJob>()

  if (existingJob) {
    const existingSlots = await env.DB.prepare(
      "SELECT * FROM upload_slots WHERE job_id = ? ORDER BY slot_id ASC",
    )
      .bind(existingJob.id)
      .all<UploadSlot>()

    return { job: existingJob, slots: existingSlots.results }
  }

  const jobId = generateId("job")
  const now = new Date()
  const expiresAt = new Date(now.getTime() + env.EXPIRATION_HOURS * 60 * 60 * 1000).toISOString()

  // 1. Insert generation_job
  await env.DB.prepare(
    `INSERT INTO generation_jobs (id, user_id, idempotency_key, status, waiting_reason, expires_at)
     VALUES (?, ?, ?, 'waiting', 'upload', ?)`,
  )
    .bind(jobId, userId, idempotencyKey, expiresAt)
    .run()

  // 2. Insert upload_slots
  const slots: UploadSlot[] = []
  for (let i = 0; i < slotCount; i++) {
    const slotIdStr = generateId("slot")
    const objectKey = `users/${userId}/jobs/${jobId}/slot_${i}`
    const slot: UploadSlot = {
      id: slotIdStr,
      job_id: jobId,
      user_id: userId,
      slot_id: i,
      object_key: objectKey,
      content_type: "image/jpeg",
      size_bytes: 0,
      checksum: "",
      status: "pending",
      expires_at: expiresAt,
    }

    await env.DB.prepare(
      `INSERT INTO upload_slots (id, job_id, user_id, slot_id, object_key, content_type, size_bytes, checksum, status, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, '', 'pending', ?)`,
    )
      .bind(slotIdStr, jobId, userId, i, objectKey, slot.content_type, expiresAt)
      .run()

    slots.push(slot)
  }

  const createdJob: GenerationJob = {
    id: jobId,
    user_id: userId,
    idempotency_key: idempotencyKey,
    status: "waiting",
    waiting_reason: "upload",
    progress_stage: null,
    failure_code: null,
    cleanup_pending: 0,
    review_artifact_id: null,
    identifier_checks_passed: 0,
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    expires_at: expiresAt,
  }

  return { job: createdJob, slots }
}

export async function getOwnedJob(env: Env, userId: string, jobId: string): Promise<GenerationJob> {
  const job = await env.DB.prepare(
    "SELECT * FROM generation_jobs WHERE id = ? AND user_id = ?",
  )
    .bind(jobId, userId)
    .first<GenerationJob>()

  if (!job) {
    throw new Error("Job not found or access denied")
  }
  return job
}

export async function transitionJob(
  env: Env,
  jobId: string,
  expectedStatus: JobStatus,
  nextStatus: JobStatus,
  patch: {
    waitingReason?: WaitingReason
    progressStage?: string | null
    failureCode?: string | null
    reviewArtifactId?: string | null
    identifierChecksPassed?: number
  } = {},
): Promise<boolean> {
  if (expectedStatus !== nextStatus && !ALLOWED_TRANSITIONS[expectedStatus].has(nextStatus)) {
    throw new Error(`Invalid status transition from ${expectedStatus} to ${nextStatus}`)
  }

  const res = await env.DB.prepare(
    `UPDATE generation_jobs
     SET status = ?,
         waiting_reason = COALESCE(?, waiting_reason),
         progress_stage = COALESCE(?, progress_stage),
         failure_code = COALESCE(?, failure_code),
         review_artifact_id = COALESCE(?, review_artifact_id),
         identifier_checks_passed = COALESCE(?, identifier_checks_passed),
         updated_at = datetime('now')
     WHERE id = ? AND status = ?`,
  )
    .bind(
      nextStatus,
      patch.waitingReason !== undefined ? patch.waitingReason : null,
      patch.progressStage !== undefined ? patch.progressStage : null,
      patch.failureCode !== undefined ? patch.failureCode : null,
      patch.reviewArtifactId !== undefined ? patch.reviewArtifactId : null,
      patch.identifierChecksPassed !== undefined ? patch.identifierChecksPassed : null,
      jobId,
      expectedStatus,
    )
    .run()

  return (res.meta?.changes ?? 0) > 0
}

export async function assertNoJobArtifactsRemain(
  env: Env,
  userId: string,
  jobId: string,
): Promise<void> {
  const prefix = `users/${userId}/jobs/${jobId}/`
  const r2List = await env.R2_BUCKET.list({ prefix, limit: 10 })
  if (r2List.objects.length > 0) {
    throw new Error(`R2 잔여 사진 객체(${r2List.objects.length}건)가 완전히 소각되지 않았습니다.`)
  }

  const artifacts = await env.DB.prepare(
    "SELECT count(*) as count FROM temp_artifacts WHERE job_id = ?",
  )
    .bind(jobId)
    .first<{ count: number }>()

  if ((artifacts?.count ?? 0) > 0) {
    throw new Error(`임시 산출물(${artifacts?.count}건)이 완전히 소각되지 않았습니다.`)
  }
}

export async function purgeJobR2AndTempData(
  env: Env,
  userId: string,
  jobId: string,
): Promise<void> {
  // 1. Mark cleanup_pending = 1
  await env.DB.prepare("UPDATE generation_jobs SET cleanup_pending = 1 WHERE id = ?")
    .bind(jobId)
    .run()

  // 2. List and delete all R2 objects for this job with retry
  const slots = await env.DB.prepare("SELECT object_key FROM upload_slots WHERE job_id = ?")
    .bind(jobId)
    .all<{ object_key: string }>()

  for (const slot of slots.results) {
    let deleted = false
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await env.R2_BUCKET.delete(slot.object_key)
        deleted = true
        break
      } catch (err) {
        if (attempt === 3) throw err
        await new Promise((r) => setTimeout(r, attempt * 100))
      }
    }
    if (!deleted) {
      throw new Error(`R2 사진 객체(${slot.object_key}) 삭제에 실패했습니다.`)
    }
  }

  // 3. Delete temp_artifacts
  await env.DB.prepare("DELETE FROM temp_artifacts WHERE job_id = ?").bind(jobId).run()

  // 4. Assert no residual objects
  await assertNoJobArtifactsRemain(env, userId, jobId)

  // 5. Mark cleanup_pending = 0
  await env.DB.prepare("UPDATE generation_jobs SET cleanup_pending = 0 WHERE id = ?")
    .bind(jobId)
    .run()
}

export async function finalizeJobByUser(
  env: Env,
  userId: string,
  jobId: string,
): Promise<{ post: Post }> {
  const job = await getOwnedJob(env, userId, jobId)
  if (job.status !== "waiting" || job.waiting_reason !== "user_review") {
    throw new Error("글 생성이 완료되지 않아 최종 발행할 수 없습니다.")
  }

  // 1. Get review draft artifact
  const draftArtifact = await env.DB.prepare(
    "SELECT * FROM temp_artifacts WHERE job_id = ? AND kind = 'draft' ORDER BY created_at DESC LIMIT 1",
  )
    .bind(jobId)
    .first<TempArtifact>()

  if (!draftArtifact) {
    throw new Error("생성된 초안 데이터를 찾을 수 없습니다.")
  }

  const postId = generateId("post")
  let title = "오늘의 교실 이야기"
  let content = draftArtifact.content
  try {
    const parsed = JSON.parse(draftArtifact.content)
    if (parsed.title) title = parsed.title
    if (parsed.content) content = parsed.content
  } catch {
    // raw text
  }

  const r2MarkdownKey = `users/${userId}/posts/${postId}.md`
  const summary = content.slice(0, 150).replace(/\n/g, " ") + "..."

  // 2. Store markdown in R2 Bucket
  await env.R2_BUCKET.put(r2MarkdownKey, content, {
    httpMetadata: { contentType: "text/markdown; charset=utf-8" },
    customMetadata: {
      userId,
      jobId,
      postId,
      title: encodeURIComponent(title),
      createdAt: new Date().toISOString(),
    },
  })

  // 3. Upsert post metadata in D1 (initially pending)
  await env.DB.prepare(
    `INSERT INTO posts (id, job_id, user_id, title, content, r2_markdown_key, summary, visibility)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
     ON CONFLICT(job_id) DO UPDATE SET
       title=excluded.title,
       content=excluded.content,
       r2_markdown_key=excluded.r2_markdown_key,
       summary=excluded.summary`,
  )
    .bind(postId, jobId, userId, title, content, r2MarkdownKey, summary)
    .run()

  // 3-1. Preserve published post photos in R2 under post directory
  const slots = await env.DB.prepare(
    "SELECT slot_id, object_key FROM upload_slots WHERE job_id = ? ORDER BY slot_id ASC",
  )
    .bind(jobId)
    .all<{ slot_id: number; object_key: string }>()

  for (const slot of slots.results || []) {
    try {
      const slotObj = await env.R2_BUCKET.get(slot.object_key)
      if (slotObj) {
        const postPhotoKey = `users/${userId}/posts/${postId}/photos/photo_${slot.slot_id}.webp`
        const buffer = await slotObj.arrayBuffer()
        await env.R2_BUCKET.put(postPhotoKey, buffer, {
          httpMetadata: { contentType: "image/webp" },
          customMetadata: {
            userId,
            postId,
            slotId: String(slot.slot_id),
            createdAt: new Date().toISOString(),
          },
        })
      }
    } catch {
      // Best effort photo copy
    }
  }

  // 4. Zero-Retention: Purge R2 Photos and Temp Artifacts with strict assertion
  await purgeJobR2AndTempData(env, userId, jobId)

  // 5. Complete Job and publish post atomically
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE generation_jobs SET status = 'completed', waiting_reason = NULL, progress_stage = 'done', updated_at = datetime('now') WHERE id = ?",
    ).bind(jobId),
    env.DB.prepare("UPDATE posts SET visibility = 'published' WHERE id = ?").bind(postId),
  ])

  const post: Post = {
    id: postId,
    job_id: jobId,
    user_id: userId,
    title,
    content,
    r2_markdown_key: r2MarkdownKey,
    summary,
    tags: "#관찰일지 #교실이야기",
    visibility: "published",
    created_at: new Date().toISOString(),
  }

  return { post }
}

export async function purgeExpiredPhotos(env: Env, now: Date): Promise<number> {
  const nowIso = now.toISOString()
  const expiredSlots = await env.DB.prepare(
    "SELECT object_key, job_id FROM upload_slots WHERE expires_at < ?",
  )
    .bind(nowIso)
    .all<{ object_key: string; job_id: string }>()

  let count = 0
  for (const slot of expiredSlots.results) {
    try {
      await env.R2_BUCKET.delete(slot.object_key)
      count++
    } catch {
      // Best effort on batch schedule
    }
  }
  return count
}

export async function purgeExpiredTempArtifacts(env: Env, now: Date): Promise<number> {
  const nowIso = now.toISOString()
  const res = await env.DB.prepare("DELETE FROM temp_artifacts WHERE expires_at < ?")
    .bind(nowIso)
    .run()
  return res.meta?.changes ?? 0
}

export async function retryPendingCleanup(env: Env): Promise<number> {
  const pendingJobs = await env.DB.prepare(
    "SELECT id, user_id FROM generation_jobs WHERE cleanup_pending = 1 LIMIT 20",
  ).all<{ id: string; user_id: string }>()

  let resolved = 0
  for (const job of pendingJobs.results) {
    try {
      await purgeJobR2AndTempData(env, job.user_id, job.id)
      resolved++
    } catch {
      // Will retry next cycle
    }
  }
  return resolved
}

export async function purgeExpiredJobs(env: Env, now: Date): Promise<number> {
  const nowIso = now.toISOString()
  const expiredJobs = await env.DB.prepare(
    "SELECT id, user_id, status FROM generation_jobs WHERE expires_at < ? AND status IN ('waiting', 'processing', 'reupload_required')",
  )
    .bind(nowIso)
    .all<{ id: string; user_id: string; status: string }>()

  let count = 0
  for (const job of expiredJobs.results) {
    try {
      await purgeJobR2AndTempData(env, job.user_id, job.id)
      await env.DB.prepare(
        "UPDATE generation_jobs SET status = 'failed', failure_code = 'SOURCE_EXPIRED', waiting_reason = NULL, pii_warning_details = NULL, updated_at = datetime('now') WHERE id = ?",
      )
        .bind(job.id)
        .run()
      count++
    } catch {
      // Handled via cleanup_pending
    }
  }
  return count
}

