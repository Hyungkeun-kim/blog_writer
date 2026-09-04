#!/usr/bin/env node
import fs from "node:fs"
import path from "node:path"

const REQUIRED_ROLES = [
  "orchestrator",
  "system-architect",
  "security-pii-auditor",
  "workflow-ai-implementer",
  "technical-qa",
]

export function checkReviewBundle(manifestPath) {
  if (!manifestPath || !fs.existsSync(manifestPath)) {
    throw new Error(`Manifest file not found: ${manifestPath}`)
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"))
  const changeDir = path.dirname(path.resolve(manifestPath))

  console.log(`Checking review bundle for: ${manifest.change_id}`)

  if (!manifest.candidate_hash) {
    throw new Error("Candidate hash is missing in manifest.")
  }

  const verdicts = manifest.verdicts || {}
  const missingRoles = []
  const failedRoles = []

  for (const role of REQUIRED_ROLES) {
    const verdict = verdicts[role]
    if (!verdict) {
      missingRoles.push(role)
      continue
    }

    if (verdict.status !== "PASS" && verdict.status !== "IMPACT_ONLY" && verdict.status !== "N/A") {
      failedRoles.push(`${role} (${verdict.status}: ${verdict.reason || "no reason"})`)
    }

    // Check if report file exists
    const reportFile = path.join(changeDir, `report-${role}.md`)
    if (!fs.existsSync(reportFile)) {
      console.warn(`Warning: Report file missing for role ${role}: ${reportFile}`)
    }
  }

  if (missingRoles.length > 0) {
    throw new Error(`Missing verdicts for required roles: ${missingRoles.join(", ")}`)
  }

  if (failedRoles.length > 0) {
    throw new Error(`Release gate blocked by role failure: ${failedRoles.join("; ")}`)
  }

  console.log("All required role verdicts are valid and approved. Release gate passed!")
  return true
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename || "")) {
  const args = process.argv.slice(2).filter((arg) => arg !== "--")
  const manifestArg = args[0]
  if (!manifestArg) {
    console.log("No manifest provided, checking latest change manifest if exists...")
    const changesDir = path.resolve("maintenance/changes")
    if (fs.existsSync(changesDir)) {
      const entries = fs.readdirSync(changesDir).sort().reverse()
      if (entries.length > 0) {
        const latestManifest = path.join(changesDir, entries[0], "manifest.json")
        if (fs.existsSync(latestManifest)) {
          checkReviewBundle(latestManifest)
          process.exit(0)
        }
      }
    }
    console.log("No active change manifest found. Review bundle check skipped.")
    process.exit(0)
  }

  try {
    checkReviewBundle(manifestArg)
  } catch (err) {
    console.error("Review bundle check failed:", err.message)
    process.exit(1)
  }
}
