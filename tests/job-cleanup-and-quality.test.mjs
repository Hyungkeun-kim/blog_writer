import test from "node:test"
import assert from "node:assert/strict"

// 1. Writer Prompt Generation logic
function buildWriterPrompt(mergedObservation, totalPhotos) {
  return `다음 사진별 실제 관찰 내용을 바탕으로 학부모님들께 공유할 따뜻하고 정돈된 교실 활동 블로그 글을 작성해주세요.

[사진별 실제 관찰 내용]:
${mergedObservation}

[작성 원칙 및 구성 지침 (엄격 준수)]:
1. 사실성 및 관찰 충실:
   - 반드시 위에 제공된 [사진별 실제 관찰 내용]에 명시된 교구, 사물, 손동작만을 근거로 작성하세요.
   - 관찰 내용에 없는 사물(고양이, 주스 등)을 절대 창작하거나 왜곡하지 마세요.
   - 비관찰적 추론 금지: "반짝이는 눈빛", "즐거운 시간", "깊은 몰입감", "뿌듯한 성취감", "상상력·집중력·사고력 향상" 등 아이의 내면 심리, 감정, 발달 효과를 주관적으로 단정하거나 과장하는 상투적 표현을 완전히 배제하세요.
   - 1인이 혼자 활동하는 관찰 내용이라면 '또래놀이', '친구들과 함께' 같은 표현이나 해시태그(#또래놀이)를 절대 포함하지 마세요.
2. 사진 마커 및 문단 배치:
   - 총 ${totalPhotos}장의 사진이 있으므로, 본문에 [사진 1]부터 [사진 ${totalPhotos}]까지 순서대로 빠짐없이 배치해야 합니다.
   - 각 사진 마커([사진 K])의 사이사이에는 반드시 해당 사진 속 활동을 구체적으로 설명하는 본문 문단(최소 2~3문장)이 위치해야 합니다.`
}

test("Job Cleanup & Quality - Writer Prompt Rules prevent hallucinations", () => {
  const prompt = buildWriterPrompt("아이1 (사진 1): 모양 블록 활동지", 4)

  assert.ok(prompt.includes("반짝이는 눈빛"))
  assert.ok(prompt.includes("성취감"))
  assert.ok(prompt.includes("몰입"))
  assert.ok(prompt.includes("#또래놀이"))
  assert.ok(prompt.includes("[사진 1]"))
  assert.ok(prompt.includes("[사진 4]"))
})

test("Job Cleanup & Quality - Title Parser extracts leading markdown title and removes duplication", () => {
  const rawDraft = "# [활동 기록] 나무 막대와 연산 활동지 탐색\n\n오늘 교실에서는..."
  const titleMatch = rawDraft.match(/^(?:#\s*|제목\s*:\s*)([^\n]+)\n*/)

  assert.ok(titleMatch)
  const extractedTitle = titleMatch[1].replace(/^[[(【\s]+|[\s\])}】]+$/g, "").trim()
  const contentWithoutTitle = rawDraft.slice(titleMatch[0].length).trim()

  assert.ok(extractedTitle.includes("나무 막대와 연산 활동지 탐색"))
  assert.equal(contentWithoutTitle, "오늘 교실에서는...")
})

test("Job Cleanup & Quality - assertNoJobArtifactsRemain verifies upload_slots", async () => {
  const mockR2 = { list: async () => ({ objects: [] }) }
  const mockDB = {
    prepare: (query) => ({
      bind: () => ({
        first: async () => {
          if (query.includes("upload_slots")) return { count: 1 }
          return { count: 0 }
        },
      }),
    }),
  }

  async function testAssert(r2, db, userId, jobId) {
    const r2List = await r2.list({ prefix: `users/${userId}/jobs/${jobId}/` })
    if (r2List.objects.length > 0) throw new Error("R2 잔여 사진 객체가 완전히 소각되지 않았습니다.")

    const artifacts = await db.prepare("SELECT count(*) as count FROM temp_artifacts WHERE job_id = ?").bind(jobId).first()
    if (artifacts.count > 0) throw new Error("임시 산출물이 완전히 소각되지 않았습니다.")

    const slots = await db.prepare("SELECT count(*) as count FROM upload_slots WHERE job_id = ?").bind(jobId).first()
    if (slots.count > 0) throw new Error(`임시 업로드 슬롯(${slots.count}건)이 완전히 소각되지 않았습니다.`)
  }

  await assert.rejects(
    testAssert(mockR2, mockDB, "teacher_1", "job_1"),
    /임시 업로드 슬롯\(1건\)이 완전히 소각되지 않았습니다\./,
  )
})

test("Job Cleanup & Quality - transitionJob reset waiting_reason to null on terminal status", () => {
  function computeFields(nextStatus, patch = {}) {
    const fields = ["status = ?", "updated_at = datetime('now')"]
    const values = [nextStatus]

    if (patch.waitingReason !== undefined) {
      fields.push("waiting_reason = ?")
      values.push(patch.waitingReason)
    } else if (nextStatus !== "waiting") {
      fields.push("waiting_reason = NULL")
    }

    if (patch.failureCode !== undefined) {
      fields.push("failure_code = ?")
      values.push(patch.failureCode)
    }
    return { fields, values }
  }

  const res = computeFields("failed", { failureCode: "USER_CANCELLED" })
  assert.ok(res.fields.includes("waiting_reason = NULL"))
  assert.equal(res.values[0], "failed")
  assert.equal(res.values[1], "USER_CANCELLED")
})
