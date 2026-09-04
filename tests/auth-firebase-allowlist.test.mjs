import test from "node:test"
import assert from "node:assert/strict"
import { verifyAuthToken } from "../src/utils/firebaseAuth.js"

test("Auth Firebase & Allowlist - Rejects legacy hardcoded tokens (teacher1234, teacher_sec_*)", async () => {
  const env = {
    ENVIRONMENT: "production",
    OWNER_EMAILS: "teacher@school.kr",
  }

  // 1. teacher1234
  const req1 = new Request("http://localhost/api/posts", {
    headers: { Authorization: "Bearer teacher1234" },
  })
  const res1 = await verifyAuthToken(req1, env)
  assert.equal(res1.valid, false)
  assert.equal(res1.status, 401)

  // 2. teacher_sec_*
  const req2 = new Request("http://localhost/api/posts", {
    headers: { Authorization: "Bearer teacher_sec_1234567890abcdef" },
  })
  const res2 = await verifyAuthToken(req2, env)
  assert.equal(res2.valid, false)
  assert.equal(res2.status, 401)
})

test("Auth Firebase & Allowlist - Rejects expired or malformed JWTs", async () => {
  const env = { ENVIRONMENT: "production", OWNER_EMAILS: "teacher@school.kr" }

  // Malformed JWT
  const reqBad = new Request("http://localhost/api/posts", {
    headers: { Authorization: "Bearer not.a.valid.jwt.payload" },
  })
  const resBad = await verifyAuthToken(reqBad, env)
  assert.equal(resBad.valid, false)
  assert.equal(resBad.status, 401)

  // Expired payload with valid JSON header
  const validHeader = Buffer.from(JSON.stringify({ alg: "RS256", kid: "key1" })).toString("base64url")
  const expiredPayload = Buffer.from(
    JSON.stringify({
      iss: "https://securetoken.google.com/test-project",
      aud: "test-project",
      sub: "uid_123",
      exp: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago
      email: "teacher@school.kr",
    }),
  ).toString("base64url")

  const expiredJwt = `${validHeader}.${expiredPayload}.mockSignature`
  const reqExp = new Request("http://localhost/api/posts", {
    headers: { Authorization: `Bearer ${expiredJwt}` },
  })
  const resExp = await verifyAuthToken(reqExp, env)
  assert.equal(resExp.valid, false)
  assert.equal(resExp.status, 401)
  assert.match(resExp.error, /만료/)
})

test("Auth Firebase & Allowlist - Rejects valid tokens if not in OWNER_EMAILS allowlist (403)", async () => {
  const env = {
    ENVIRONMENT: "test",
    OWNER_EMAILS: "authorized@school.kr",
  }

  // User with unauthorized email
  const req = new Request("http://localhost/api/posts", {
    headers: { Authorization: "Bearer test_token_unauthorized" },
  })
  const res = await verifyAuthToken(req, env)
  assert.equal(res.valid, false)
  assert.equal(res.status, 403)
  assert.match(res.error, /소유자 목록에 등록되지 않았습니다/)
})

test("Auth Firebase & Allowlist - Accepts authorized user matching allowlist (200)", async () => {
  const env = {
    ENVIRONMENT: "test",
    OWNER_EMAILS: "owner@example.com",
    ALLOWED_USER_UIDS: "owner",
  }

  const req = new Request("http://localhost/api/posts", {
    headers: { Authorization: "Bearer test_token_owner" },
  })
  const res = await verifyAuthToken(req, env)
  assert.equal(res.valid, true)
  assert.equal(res.status, 200)
  assert.equal(res.userId, "owner")
})
