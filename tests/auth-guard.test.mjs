import test from "node:test"
import assert from "node:assert/strict"
import { verifyAuthToken } from "../src/utils/firebaseAuth.js"

const defaultEnv = {
  ENVIRONMENT: "test",
  OWNER_EMAILS: "teacher@school.kr",
  ALLOWED_USER_UIDS: "teacher_primary",
  INTERNAL_SERVICE_TOKEN: "internal_secret_key_12345",
}

test("Auth Guard - Rejects requests missing Authorization header", async () => {
  const req = new Request("http://localhost/api/posts")
  const res = await verifyAuthToken(req, defaultEnv)
  assert.equal(res.valid, false)
  assert.equal(res.status, 401)
})

test("Auth Guard - Rejects malformed or non-Bearer schemes", async () => {
  const reqBasic = new Request("http://localhost/api/posts", {
    headers: { Authorization: "Basic dXNlcjpwYXNz" },
  })
  const resBasic = await verifyAuthToken(reqBasic, defaultEnv)
  assert.equal(resBasic.valid, false)
  assert.equal(resBasic.status, 401)

  const reqEmpty = new Request("http://localhost/api/posts", {
    headers: { Authorization: "Bearer " },
  })
  const resEmpty = await verifyAuthToken(reqEmpty, defaultEnv)
  assert.equal(resEmpty.valid, false)
  assert.equal(resEmpty.status, 401)
})

test("Auth Guard - Rejects unauthorized tokens", async () => {
  const reqWrong = new Request("http://localhost/api/posts", {
    headers: { Authorization: "Bearer invalid_random_token" },
  })
  const resWrong = await verifyAuthToken(reqWrong, defaultEnv)
  assert.equal(resWrong.valid, false)
  assert.equal(resWrong.status, 401)
})

test("Auth Guard - Accepts internal service token and allowlist matched user", async () => {
  // 1. Internal service token
  const reqSec = new Request("http://localhost/api/posts", {
    headers: {
      Authorization: "Bearer internal_secret_key_12345",
      "X-Owner-Id": "teacher_primary",
    },
  })
  const resSec = await verifyAuthToken(reqSec, defaultEnv)
  assert.equal(resSec.valid, true)
  assert.equal(resSec.status, 200)
  assert.equal(resSec.userId, "teacher_primary")

  // 2. Allowlist test token
  const reqOwner = new Request("http://localhost/api/posts", {
    headers: { Authorization: "Bearer test_token_teacher_primary" },
  })
  const resOwner = await verifyAuthToken(reqOwner, defaultEnv)
  assert.equal(resOwner.valid, true)
  assert.equal(resOwner.status, 200)
  assert.equal(resOwner.userId, "teacher_primary")
})
