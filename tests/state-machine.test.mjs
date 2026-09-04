import test from "node:test"
import assert from "node:assert/strict"
import { validateTransition } from "../scripts/check-state-machine.mjs"

test("State Machine - Valid Transitions", () => {
  assert.equal(validateTransition("waiting", "processing", "upload"), true)
  assert.equal(validateTransition("processing", "waiting", "user_review"), true)
  assert.equal(validateTransition("waiting", "completed", "user_review"), true)
  assert.equal(validateTransition("processing", "failed"), true)
  assert.equal(validateTransition("reupload_required", "waiting", "upload"), true)
})

test("State Machine - Reject Invalid Direct Transitions", () => {
  // waiting cannot directly jump to completed without user_review reason
  assert.throws(() => validateTransition("waiting", "completed", "upload"))

  // completed & failed are terminal
  assert.throws(() => validateTransition("completed", "processing"))
  assert.throws(() => validateTransition("failed", "processing"))
  assert.throws(() => validateTransition("failed", "waiting"))
})
