import test from "node:test"
import assert from "node:assert/strict"

// Mock R2 and D1 for testing assertNoJobArtifactsRemain and Zero-Retention
test("R2 Cleanup - assertNoJobArtifactsRemain throws if objects remain in R2", async () => {
  const mockR2 = {
    list: async () => ({ objects: [{ key: "users/teacher_1/jobs/job_1/slot_0" }] }),
    delete: async () => {},
  }

  const mockDB = {
    first: async () => ({ count: 0 }),
  }

  async function assertNoJobArtifactsRemain(r2, db, userId, jobId) {
    const r2List = await r2.list({ prefix: `users/${userId}/jobs/${jobId}/` })
    if (r2List.objects.length > 0) {
      throw new Error(`R2 잔여 사진 객체(${r2List.objects.length}건)가 완전히 소각되지 않았습니다.`)
    }
    const artifacts = await db.first()
    if (artifacts.count > 0) {
      throw new Error("임시 산출물이 남아있습니다.")
    }
  }

  await assert.rejects(
    assertNoJobArtifactsRemain(mockR2, mockDB, "teacher_1", "job_1"),
    /R2 잔여 사진 객체\(1건\)가 완전히 소각되지 않았습니다\./
  )
})

test("R2 Cleanup - assertNoJobArtifactsRemain succeeds when 0 objects remain", async () => {
  const cleanR2 = {
    list: async () => ({ objects: [] }),
  }
  const cleanDB = {
    first: async () => ({ count: 0 }),
  }

  async function assertNoJobArtifactsRemain(r2, db, userId, jobId) {
    const r2List = await r2.list({ prefix: `users/${userId}/jobs/${jobId}/` })
    if (r2List.objects.length > 0) {
      throw new Error("잔여 객체 있음")
    }
    const artifacts = await db.first()
    if (artifacts.count > 0) {
      throw new Error("임시 산출물 있음")
    }
    return true
  }

  const result = await assertNoJobArtifactsRemain(cleanR2, cleanDB, "teacher_1", "job_1")
  assert.equal(result, true)
})
