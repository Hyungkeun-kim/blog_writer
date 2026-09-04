import test from "node:test"
import assert from "node:assert/strict"
import { detectPII } from "../scripts/check-pii-rules.mjs"

test("PII Detector - Detect RRN and Phone", () => {
  const rrnMatch = detectPII("주민번호 990101-1234567 포함")
  assert.ok(rrnMatch.includes("korean_rrn"))

  const phoneMatch = detectPII("연락처: 010-9876-5432")
  assert.ok(phoneMatch.includes("phone_number"))
})

test("PII Detector - Detect Email and Passport", () => {
  const emailMatch = detectPII("문의 이메일: user@domain.co.kr")
  assert.ok(emailMatch.includes("email_address"))

  const passportMatch = detectPII("여권번호 M12345678")
  assert.ok(passportMatch.includes("passport_kr"))
})

test("PII Detector - Normal Text Passes Without Detections", () => {
  const cleanMatch = detectPII("오늘 제주도 여행 사진을 공유합니다. 날씨가 참 맑네요.")
  assert.equal(cleanMatch.length, 0)
})
