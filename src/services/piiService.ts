import { PiiDetectionResult } from "../types/job.js"

export const PII_PATTERNS: Record<string, RegExp> = {
  korean_rrn: /\b\d{6}-[1-4]\d{6}\b/,
  phone_number: /\b01[016789]-?\d{3,4}-?\d{4}\b/,
  email_address: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/,
  credit_card: /\b(?:\d{4}-){3}\d{4}\b/,
  passport_kr: /\b[MS]\d{8}\b/,
  drivers_license_kr: /\b\d{2}-\d{2}-\d{6}-\d{2}\b/,
}

export function detectPII(text: string): PiiDetectionResult {
  if (typeof text !== "string" || text.trim().length === 0) {
    return { detected: false, categories: [], reasonCode: null }
  }

  const foundCategories: string[] = []
  for (const [category, regex] of Object.entries(PII_PATTERNS)) {
    if (regex.test(text)) {
      foundCategories.push(category)
    }
  }

  if (foundCategories.length > 0) {
    return {
      detected: true,
      categories: foundCategories,
      reasonCode: "PROHIBITED_IDENTIFIER_DETECTED",
    }
  }

  return { detected: false, categories: [], reasonCode: null }
}
