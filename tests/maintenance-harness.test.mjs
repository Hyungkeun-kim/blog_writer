import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { prepareContexts } from "../scripts/prepare-agent-contexts.mjs"
import { checkReviewBundle } from "../scripts/check-review-bundle.mjs"

test("Maintenance Harness - Context Packet Creation and Check", () => {
  const tmpDir = path.resolve("maintenance/changes/test-fixture")
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true })
  }

  const manifestData = {
    schema_version: "1.0.0",
    change_id: "test-fixture",
    title: "테스트 변경",
    summary: "테스트 하네스 검증용",
    candidate_hash: "sha256:dummytest123",
    target_files: ["package.json"],
    verdicts: {
      "orchestrator": { "status": "PASS", "reason": "테스트 승인" },
      "system-architect": { "status": "PASS", "reason": "아키텍처 승인" },
      "security-pii-auditor": { "status": "PASS", "reason": "보안 승인" },
      "workflow-ai-implementer": { "status": "PASS", "reason": "구현 승인" },
      "technical-qa": { "status": "PASS", "reason": "QA 승인" }
    }
  }

  const manifestPath = path.join(tmpDir, "manifest.json")
  fs.writeFileSync(manifestPath, JSON.stringify(manifestData, null, 2), "utf-8")

  // Generate context packets
  prepareContexts(manifestPath)

  assert.ok(fs.existsSync(path.join(tmpDir, "context-orchestrator.json")))
  assert.ok(fs.existsSync(path.join(tmpDir, "context-system-architect.json")))
  assert.ok(fs.existsSync(path.join(tmpDir, "context-security-pii-auditor.json")))
  assert.ok(fs.existsSync(path.join(tmpDir, "context-workflow-ai-implementer.json")))
  assert.ok(fs.existsSync(path.join(tmpDir, "context-technical-qa.json")))

  // Check bundle
  assert.equal(checkReviewBundle(manifestPath), true)

  // Clean up
  fs.rmSync(tmpDir, { recursive: true, force: true })
})
