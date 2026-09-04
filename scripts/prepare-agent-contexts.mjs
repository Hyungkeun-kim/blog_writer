#!/usr/bin/env node
import fs from "node:fs"
import path from "node:path"

const ROLES = [
  "orchestrator",
  "system-architect",
  "security-pii-auditor",
  "workflow-ai-implementer",
  "technical-qa",
]

export function prepareContexts(manifestPath) {
  if (!manifestPath || !fs.existsSync(manifestPath)) {
    throw new Error(`Manifest file not found: ${manifestPath}`)
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"))
  const changeDir = path.dirname(path.resolve(manifestPath))
  const projectRoot = path.resolve(changeDir, "../..")

  console.log(`Preparing agent contexts for change: ${manifest.change_id || path.basename(changeDir)}`)

  for (const role of ROLES) {
    const contextData = {
      role,
      change_id: manifest.change_id,
      title: manifest.title,
      summary: manifest.summary,
      target_files: manifest.target_files || [],
      candidate_hash: manifest.candidate_hash,
      policy: manifest.policy || {},
      created_at: new Date().toISOString(),
    }

    const outFile = path.join(changeDir, `context-${role}.json`)
    fs.writeFileSync(outFile, JSON.stringify(contextData, null, 2), "utf-8")
    console.log(`Generated context for ${role}: ${path.relative(projectRoot, outFile)}`)
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename || "")) {
  const args = process.argv.slice(2).filter((arg) => arg !== "--")
  const manifestArg = args[0]
  if (!manifestArg) {
    console.error("Usage: node scripts/prepare-agent-contexts.mjs <path-to-manifest.json>")
    process.exit(1)
  }
  try {
    prepareContexts(manifestArg)
  } catch (err) {
    console.error("Failed to prepare agent contexts:", err.message)
    process.exit(1)
  }
}
