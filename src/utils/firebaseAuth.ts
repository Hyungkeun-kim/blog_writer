/**
 * Firebase ID Token & Internal Service Token Verification Module
 * Complies with SECURITY-PRIVACY.md v3.0 & TECH-DESIGN.md v3.0
 */

import { Env } from "../types/env.js"

export interface AuthUser {
  uid: string
  email?: string
  emailVerified?: boolean
}

export interface AuthResult {
  valid: boolean
  status: 200 | 401 | 403
  userId?: string
  user?: AuthUser
  error?: string
}

// In-memory Google JWKS cache
let jwksCache: { keys: JsonWebKey[]; expiresAt: number } | null = null

async function getGooglePublicKeys(): Promise<JsonWebKey[]> {
  const now = Date.now()
  if (jwksCache && jwksCache.expiresAt > now) {
    return jwksCache.keys
  }

  try {
    const res = await fetch("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com")
    if (!res.ok) throw new Error("Failed to fetch Google JWKS")
    const data = (await res.json()) as { keys: JsonWebKey[] }
    // Cache for 1 hour
    jwksCache = {
      keys: data.keys || [],
      expiresAt: now + 3600 * 1000,
    }
    return jwksCache.keys
  } catch {
    return jwksCache ? jwksCache.keys : []
  }
}

function base64UrlDecode(str: string): Uint8Array {
  str = str.replace(/-/g, "+").replace(/_/g, "/")
  while (str.length % 4) str += "="
  const binary = atob(str)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

export async function verifyAuthToken(request: Request, env: Env): Promise<AuthResult> {
  const authHeader = request.headers.get("Authorization")
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return {
      valid: false,
      status: 401,
      error: "인증 헤더(Authorization: Bearer <토큰>)가 누락되었습니다.",
    }
  }

  const token = authHeader.slice(7).trim()
  if (!token) {
    return {
      valid: false,
      status: 401,
      error: "토큰이 비어 있습니다.",
    }
  }

  // 1. Internal Service Token (BFF -> Worker direct communication)
  const internalSecret = env.INTERNAL_SERVICE_TOKEN || env.APP_ACCESS_TOKEN
  if (internalSecret && token === internalSecret) {
    const headerOwner = request.headers.get("X-Owner-Id") || "owner_primary"
    return {
      valid: true,
      status: 200,
      userId: headerOwner,
      user: { uid: headerOwner, email: "owner@primary.internal", emailVerified: true },
    }
  }

  // 2. Automated Test / Local Mock Tokens (Only permitted in test/development with strictly matching mock format)
  if (env.ENVIRONMENT !== "production" && token.startsWith("test_token_")) {
    const mockUid = token.slice("test_token_".length) || "test_user"
    const mockEmail = `${mockUid}@example.com`
    return checkAllowlist(mockUid, mockEmail, env)
  }

  // 3. Firebase ID Token (JWT: Header.Payload.Signature)
  const parts = token.split(".")
  if (parts.length !== 3) {
    return {
      valid: false,
      status: 401,
      error: "유효하지 않은 JWT 토큰 형식입니다.",
    }
  }

  try {
    const headerJson = new TextDecoder().decode(base64UrlDecode(parts[0]))
    const payloadJson = new TextDecoder().decode(base64UrlDecode(parts[1]))
    const header = JSON.parse(headerJson) as { kid?: string; alg?: string }
    const payload = JSON.parse(payloadJson) as {
      iss?: string
      aud?: string
      sub?: string
      exp?: number
      email?: string
      email_verified?: boolean
    }

    // Basic claim checks
    const nowSec = Math.floor(Date.now() / 1000)
    if (!payload.exp || payload.exp < nowSec) {
      return { valid: false, status: 401, error: "토큰이 만료되었습니다." }
    }

    if (!payload.sub) {
      return { valid: false, status: 401, error: "토큰에 sub(사용자 식별자)가 없습니다." }
    }

    // Check Firebase project ID if configured
    if (env.FIREBASE_PROJECT_ID) {
      const expectedIss = `https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}`
      if (payload.iss !== expectedIss || payload.aud !== env.FIREBASE_PROJECT_ID) {
        return { valid: false, status: 401, error: "토큰의 발급자(iss) 또는 대상(aud)이 일치하지 않습니다." }
      }
    }

    // Crypto signature verification if Google JWKS keys available
    if (header.kid && header.alg === "RS256") {
      const keys = await getGooglePublicKeys()
      const matchedKey = keys.find((k) => (k as { kid?: string }).kid === header.kid)
      if (matchedKey) {
        const cryptoKey = await crypto.subtle.importKey(
          "jwk",
          matchedKey,
          { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
          false,
          ["verify"],
        )
        const signedData = new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
        const signature = base64UrlDecode(parts[2])
        const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", cryptoKey, signature, signedData)
        if (!ok) {
          return { valid: false, status: 401, error: "토큰 서명 검증에 실패했습니다." }
        }
      }
    }

    // Check Allowlist
    return checkAllowlist(payload.sub, payload.email, env, payload.email_verified)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "토큰 파싱 오류"
    return { valid: false, status: 401, error: `인증 토큰 검증 실패: ${msg}` }
  }
}

function checkAllowlist(uid: string, email: string | undefined, env: Env, emailVerified = true): AuthResult {
  const allowedEmailsStr = env.OWNER_EMAILS || env.ALLOWED_USER_EMAILS || ""
  const allowedUidsStr = env.OWNER_UIDS || env.ALLOWED_USER_UIDS || ""

  const allowedEmails = allowedEmailsStr
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
  const allowedUids = allowedUidsStr
    .split(",")
    .map((u) => u.trim())
    .filter(Boolean)

  // If allowlist is configured, user must match either email or uid
  if (allowedEmails.length > 0 || allowedUids.length > 0) {
    const emailMatch = email && allowedEmails.includes(email.toLowerCase())
    const uidMatch = allowedUids.includes(uid)

    if (!emailMatch && !uidMatch) {
      return {
        valid: false,
        status: 403,
        error: "인가되지 않은 계정입니다. 시스템 소유자 목록에 등록되지 않았습니다.",
      }
    }
  }

  return {
    valid: true,
    status: 200,
    userId: uid,
    user: { uid, email, emailVerified },
  }
}
