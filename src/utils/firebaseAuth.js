let jwksCache = null;
async function getGooglePublicKeys() {
  const now = Date.now();
  if (jwksCache && jwksCache.expiresAt > now) {
    return jwksCache.keys;
  }
  try {
    const res = await fetch("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com");
    if (!res.ok)
      throw new Error("Failed to fetch Google JWKS");
    const data = await res.json();
    jwksCache = {
      keys: data.keys || [],
      expiresAt: now + 3600 * 1e3
    };
    return jwksCache.keys;
  } catch {
    return jwksCache ? jwksCache.keys : [];
  }
}
function base64UrlDecode(str) {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4)
    str += "=";
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
async function verifyAuthToken(request, env) {
  let token = "";
  const authHeader = request.headers.get("Authorization");
  if (authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.slice(7).trim();
  } else {
    try {
      const url = new URL(request.url);
      const qToken = url.searchParams.get("token");
      if (qToken) {
        token = qToken.trim();
      }
    } catch {
      // Ignore malformed URL
    }
  }
  if (!token) {
    return {
      valid: false,
      status: 401,
      error: "\uC778\uC99D \uD5E4\uB354(Authorization: Bearer <\uD1A0\uD070>)\uAC00 \uB204\uB77D\uB418\uC5C8\uC2B5\uB2C8\uB2E4."
    };
  }
  const internalSecret = env.INTERNAL_SERVICE_TOKEN || env.APP_ACCESS_TOKEN;
  if (internalSecret && token === internalSecret) {
    const headerOwner = request.headers.get("X-Owner-Id") || "owner_primary";
    return {
      valid: true,
      status: 200,
      userId: headerOwner,
      user: { uid: headerOwner, email: "owner@primary.internal", emailVerified: true }
    };
  }
  if (env.ENVIRONMENT !== "production" && token.startsWith("test_token_")) {
    const mockUid = token.slice("test_token_".length) || "test_user";
    const mockEmail = `${mockUid}@example.com`;
    return checkAllowlist(mockUid, mockEmail, env);
  }
  const parts = token.split(".");
  if (parts.length !== 3) {
    return {
      valid: false,
      status: 401,
      error: "\uC720\uD6A8\uD558\uC9C0 \uC54A\uC740 JWT \uD1A0\uD070 \uD615\uC2DD\uC785\uB2C8\uB2E4."
    };
  }
  try {
    const headerJson = new TextDecoder().decode(base64UrlDecode(parts[0]));
    const payloadJson = new TextDecoder().decode(base64UrlDecode(parts[1]));
    const header = JSON.parse(headerJson);
    const payload = JSON.parse(payloadJson);
    const nowSec = Math.floor(Date.now() / 1e3);
    if (!payload.exp || payload.exp < nowSec) {
      return { valid: false, status: 401, error: "\uD1A0\uD070\uC774 \uB9CC\uB8CC\uB418\uC5C8\uC2B5\uB2C8\uB2E4." };
    }
    if (!payload.sub) {
      return { valid: false, status: 401, error: "\uD1A0\uD070\uC5D0 sub(\uC0AC\uC6A9\uC790 \uC2DD\uBCC4\uC790)\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4." };
    }
    if (env.FIREBASE_PROJECT_ID) {
      const expectedIss = `https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}`;
      if (payload.iss !== expectedIss || payload.aud !== env.FIREBASE_PROJECT_ID) {
        return { valid: false, status: 401, error: "\uD1A0\uD070\uC758 \uBC1C\uAE09\uC790(iss) \uB610\uB294 \uB300\uC0C1(aud)\uC774 \uC77C\uCE58\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4." };
      }
    }
    if (header.kid && header.alg === "RS256") {
      const keys = await getGooglePublicKeys();
      const matchedKey = keys.find((k) => k.kid === header.kid);
      if (matchedKey) {
        const cryptoKey = await crypto.subtle.importKey(
          "jwk",
          matchedKey,
          { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
          false,
          ["verify"]
        );
        const signedData = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
        const signature = base64UrlDecode(parts[2]);
        const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", cryptoKey, signature, signedData);
        if (!ok) {
          return { valid: false, status: 401, error: "\uD1A0\uD070 \uC11C\uBA85 \uAC80\uC99D\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4." };
        }
      }
    }
    return checkAllowlist(payload.sub, payload.email, env, payload.email_verified);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "\uD1A0\uD070 \uD30C\uC2F1 \uC624\uB958";
    return { valid: false, status: 401, error: `\uC778\uC99D \uD1A0\uD070 \uAC80\uC99D \uC2E4\uD328: ${msg}` };
  }
}
function checkAllowlist(uid, email, env, emailVerified = true) {
  const allowedEmailsStr = env.OWNER_EMAILS || env.ALLOWED_USER_EMAILS || "";
  const allowedUidsStr = env.OWNER_UIDS || env.ALLOWED_USER_UIDS || "";
  const allowedEmails = allowedEmailsStr.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  const allowedUids = allowedUidsStr.split(",").map((u) => u.trim()).filter(Boolean);
  if (allowedEmails.length > 0 || allowedUids.length > 0) {
    const emailMatch = email && allowedEmails.includes(email.toLowerCase());
    const uidMatch = allowedUids.includes(uid);
    if (!emailMatch && !uidMatch) {
      return {
        valid: false,
        status: 403,
        error: "\uC778\uAC00\uB418\uC9C0 \uC54A\uC740 \uACC4\uC815\uC785\uB2C8\uB2E4. \uC2DC\uC2A4\uD15C \uC18C\uC720\uC790 \uBAA9\uB85D\uC5D0 \uB4F1\uB85D\uB418\uC9C0 \uC54A\uC558\uC2B5\uB2C8\uB2E4."
      };
    }
  }
  return {
    valid: true,
    status: 200,
    userId: uid,
    user: { uid, email, emailVerified }
  };
}
export {
  verifyAuthToken
};
