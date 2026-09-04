import test from "node:test"
import assert from "node:assert/strict"

test("Settings Validation - Rejects unknown keys", () => {
  const allowedKeys = new Set([
    "retentionHours",
    "expirationHours",
    "maxImageBytes",
    "visionModel",
    "writerModel",
    "qualityModel",
    "maxOutputTokens",
    "parallelVisionSlots",
    "aiTimeoutSeconds",
  ])

  function validate(body) {
    for (const key of Object.keys(body)) {
      if (!allowedKeys.has(key)) return { valid: false, error: "INVALID_SETTING_KEY" }
    }
    return { valid: true }
  }

  assert.equal(validate({ unknownHackKey: true }).valid, false)
  assert.equal(validate({ retentionHours: 24, maxImageBytes: 10485760, aiTimeoutSeconds: 180 }).valid, true)
})

test("Settings Validation - Enforces ranges on retentionHours, maxImageBytes, and aiTimeoutSeconds", () => {
  function validateRanges(body) {
    if ("retentionHours" in body) {
      const val = Number(body.retentionHours)
      if (!Number.isInteger(val) || val < 1 || val > 72) return false
    }
    if ("maxImageBytes" in body) {
      const val = Number(body.maxImageBytes)
      if (!Number.isInteger(val) || val < 1048576 || val > 20971520) return false
    }
    if ("aiTimeoutSeconds" in body) {
      const val = Number(body.aiTimeoutSeconds)
      if (!Number.isInteger(val) || val < 30 || val > 600) return false
    }
    return true
  }

  assert.equal(validateRanges({ retentionHours: 0 }), false)
  assert.equal(validateRanges({ retentionHours: 100 }), false)
  assert.equal(validateRanges({ retentionHours: 24 }), true)
  assert.equal(validateRanges({ maxImageBytes: 500 }), false) // Under 1MB
  assert.equal(validateRanges({ maxImageBytes: 50000000 }), false) // Over 20MB
  assert.equal(validateRanges({ maxImageBytes: 10485760 }), true) // 10MB
  assert.equal(validateRanges({ aiTimeoutSeconds: 20 }), false) // Under 30s
  assert.equal(validateRanges({ aiTimeoutSeconds: 700 }), false) // Over 600s
  assert.equal(validateRanges({ aiTimeoutSeconds: 180 }), true)
})
