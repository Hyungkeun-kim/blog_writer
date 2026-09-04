#!/usr/bin/env node
import path from "node:path"

export const PII_PATTERNS = {
  korean_rrn: /\b\d{6}-[1-4]\d{6}\b/,
  phone_number: /\b01[016789]-?\d{3,4}-?\d{4}\b/,
  email_address: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/,
  credit_card: /\b(?:\d{4}-){3}\d{4}\b/,
  passport_kr: /\b[MS]\d{8}\b/,
  drivers_license_kr: /\b\d{2}-\d{2}-\d{6}-\d{2}\b/,
}

export function detectPII(text) {
  if (typeof text !== "string") return []
  const found = []
  for (const [ruleName, regex] of Object.entries(PII_PATTERNS)) {
    if (regex.test(text)) {
      found.push(ruleName)
    }
  }
  return found
}

function runChecks() {
  console.log("Checking PII detector rules...")

  const sampleTexts = [
    { text: "제 주민번호는 950101-1234567 입니다.", expected: ["korean_rrn"] },
    { text: "연락처는 010-1234-5678 로 주세요.", expected: ["phone_number"] },
    { text: "이메일은 test@example.com 입니다.", expected: ["email_address"] },
    { text: "평화로운 풍경 사진과 맛있는 음식 이야기", expected: [] },
  ]

  for (const sample of sampleTexts) {
    const detected = detectPII(sample.text)
    if (sample.expected.length === 0 && detected.length > 0) {
      throw new Error(`False positive PII detection on: "${sample.text}", detected: ${detected.join(", ")}`)
    }
    for (const exp of sample.expected) {
      if (!detected.includes(exp)) {
        throw new Error(`Failed to detect expected PII '${exp}' in: "${sample.text}"`)
      }
    }
  }

  console.log("PII detection rules validation passed.")
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename || "")) {
  try {
    runChecks()
  } catch (err) {
    console.error("PII check failed:", err.message)
    process.exit(1)
  }
}
