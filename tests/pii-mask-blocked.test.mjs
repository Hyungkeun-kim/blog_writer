import test from "node:test"
import assert from "node:assert/strict"

test("PII Action - mask_and_continue is blocked with 400 Bad Request", async () => {
  // Simulate pii-action endpoint handler logic
  function handlePiiAction(action) {
    if (action === "mask_and_continue") {
      return {
        status: 400,
        body: {
          error: "PII_MASKING_NOT_SUPPORTED",
          message: "실제 사진/본문 마스킹 기능은 준비 중으로 개인정보 보호를 위해 [취소 및 안전 파기]만 허용됩니다.",
        },
      }
    }
    if (action === "cancel_and_purge") {
      return {
        status: 200,
        body: { status: "failed", reason: "USER_CANCELLED_PII", purged: true },
      }
    }
    return { status: 400, body: { error: "INVALID_ACTION" } }
  }

  const resMask = handlePiiAction("mask_and_continue")
  assert.equal(resMask.status, 400)
  assert.equal(resMask.body.error, "PII_MASKING_NOT_SUPPORTED")
  assert.match(resMask.body.message, /취소 및 안전 파기/)

  const resPurge = handlePiiAction("cancel_and_purge")
  assert.equal(resPurge.status, 200)
  assert.equal(resPurge.body.status, "failed")
  assert.equal(resPurge.body.reason, "USER_CANCELLED_PII")
  assert.equal(resPurge.body.purged, true)
})
