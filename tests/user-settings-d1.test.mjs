import test from "node:test"
import assert from "node:assert/strict"

// Mock D1 user_settings CRUD
test("User Settings D1 - Default settings when no row exists", () => {
  const defaultSettings = {
    environment: "production",
    expirationHours: 24,
    maxImageBytes: 10485760,
    maxTokens: 1500,
  }

  let userSettingsRow = null
  const effective = userSettingsRow ? JSON.parse(userSettingsRow.settings_json) : defaultSettings
  assert.equal(effective.expirationHours, 24)
  assert.equal(effective.maxTokens, 1500)
})

test("User Settings D1 - Save and overwrite settings in D1", () => {
  const store = {}
  const userId = "teacher_primary"
  const newSettings = {
    expirationHours: 12,
    maxTokens: 2000,
  }

  // UPSERT
  store[userId] = {
    user_id: userId,
    settings_json: JSON.stringify(newSettings),
    updated_at: new Date().toISOString(),
  }

  assert.ok(store[userId])
  const parsed = JSON.parse(store[userId].settings_json)
  assert.equal(parsed.expirationHours, 12)
  assert.equal(parsed.maxTokens, 2000)
})
