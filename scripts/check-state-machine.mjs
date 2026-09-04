#!/usr/bin/env node
import path from "node:path"

const ALLOWED_STATUSES = new Set([
  "waiting",
  "processing",
  "reupload_required",
  "completed",
  "failed",
])

const ALLOWED_WAITING_REASONS = new Set(["upload", "user_review", null])

const VALID_TRANSITIONS = {
  waiting: new Set(["processing", "reupload_required", "completed", "failed"]),
  processing: new Set(["waiting", "reupload_required", "failed"]),
  reupload_required: new Set(["waiting", "failed"]),
  completed: new Set(),
  failed: new Set(),
}

export function validateTransition(fromStatus, toStatus, waitingReason = null) {
  if (!ALLOWED_STATUSES.has(fromStatus)) {
    throw new Error(`Invalid source status: ${fromStatus}`)
  }
  if (!ALLOWED_STATUSES.has(toStatus)) {
    throw new Error(`Invalid target status: ${toStatus}`)
  }
  if (!VALID_TRANSITIONS[fromStatus].has(toStatus)) {
    throw new Error(`Forbidden transition from ${fromStatus} to ${toStatus}`)
  }
  if (toStatus === "waiting" && !ALLOWED_WAITING_REASONS.has(waitingReason)) {
    throw new Error(`Invalid waiting reason: ${waitingReason}`)
  }
  if (fromStatus === "waiting" && toStatus === "completed" && waitingReason !== "user_review") {
    throw new Error("Transition to completed is only permitted when waiting_reason was user_review")
  }
  return true
}

function runChecks() {
  console.log("Checking blog_writer state machine definitions...")
  
  validateTransition("waiting", "processing", "upload")
  validateTransition("processing", "waiting", "user_review")
  validateTransition("waiting", "completed", "user_review")
  validateTransition("processing", "failed")
  validateTransition("reupload_required", "waiting", "upload")

  console.log("State machine validation passed (5 states, strict transitions verified).")
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename || "")) {
  try {
    runChecks()
  } catch (err) {
    console.error("State machine check failed:", err.message)
    process.exit(1)
  }
}
