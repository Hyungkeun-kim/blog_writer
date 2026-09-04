/**
 * On-Demand Style Learning Service
 */

import { Env } from "../types/env.js"
import { Post, UserStyleProfile } from "../types/job.js"
import { generateId } from "../utils/crypto.js"
import { detectPII } from "./piiService.js"

export async function getUserStyleProfile(
  env: Env,
  userId: string,
): Promise<UserStyleProfile | null> {
  const profile = await env.DB.prepare(
    "SELECT * FROM user_style_profiles WHERE user_id = ?",
  )
    .bind(userId)
    .first<UserStyleProfile>()

  return profile || null
}

export async function learnUserStyle(
  env: Env,
  userId: string,
  postLimit = 5,
): Promise<{ profile: UserStyleProfile; message: string }> {
  // 1. Fetch user's previous posts approved for learning
  const posts = await env.DB.prepare(
    `SELECT * FROM posts
     WHERE user_id = ? AND visibility = 'published' AND approved_for_learning = 1
     ORDER BY created_at DESC
     LIMIT ?`,
  )
    .bind(userId, postLimit)
    .all<Post>()

  if (!posts.results || posts.results.length === 0) {
    const defaultTone = "선생님의 다정하고 따뜻한 시선이 담긴 어조로, 아이들의 관찰 행동을 부드럽게 서술합니다. (~했어요, ~했답니다 어미 활용)"
    const profileId = generateId("style")
    const updatedProfile: UserStyleProfile = {
      id: profileId,
      user_id: userId,
      tone_style: defaultTone,
      sample_snippets: "[]",
      learned_post_count: 0,
      updated_at: new Date().toISOString(),
    }

    await env.DB.prepare(
      `INSERT INTO user_style_profiles (id, user_id, tone_style, sample_snippets, learned_post_count, updated_at)
       VALUES (?, ?, ?, '[]', 0, datetime('now'))
       ON CONFLICT(user_id) DO UPDATE SET
         tone_style = excluded.tone_style,
         updated_at = datetime('now')`,
    )
      .bind(profileId, userId, defaultTone)
      .run()

    return {
      profile: updatedProfile,
      message: "아직 작성 완료된 글이 없어 '기본 다정한 선생님 문체'로 프로필이 설정되었습니다. 앞으로 글을 작성하시면 선생님 고유의 문체로 자동 업그레이드됩니다.",
    }
  }

  // 2. Concatenate post contents for style analysis
  const combinedSamples = posts.results
    .map((p, idx) => `[예시 글 ${idx + 1} - 제목: ${p.title}]\n${p.content}`)
    .join("\n\n---\n\n")

  let learnedTone = "선생님의 다정하고 따뜻한 시선이 담긴 어조로, 아이들의 관찰 행동을 부드럽게 서술합니다."
  try {
    if (env.AI && env.ENVIRONMENT === "production") {
      const aiRes = await env.AI.run("@cf/google/gemma-4-26b-a4b-it", {
        messages: [
          {
            role: "user",
            content: `다음은 한 유치원/어린이집 선생님이 작성하신 블로그 글 예시입니다.
이 글들의 '문체 특징(자주 쓰는 어미 ex: ~했어요, ~했답니다, 어조, 문장 호흡, 분위기, 이모지 활용 스타일)'을 분석하여, 앞으로 글을 쓸 때 적용할 '핵심 문체 작성 가이드라인'을 3~5줄로 간결하게 요약해주세요.

[선생님의 기존 글 모음]
${combinedSamples}`,
          },
        ],
        max_completion_tokens: 500,
      })

      if (aiRes.response && aiRes.response.trim().length > 0) {
        learnedTone = aiRes.response.trim()
      }
    }
  } catch {
    learnedTone = "자주 사용하는 어미(~했어요, ~했답니다)를 살린 친근하고 따뜻한 관찰 서술 문체."
  }

  const profileId = generateId("style")
  const sampleSnippets = JSON.stringify(
    posts.results.map((p) => ({ title: p.title, snippet: p.content?.slice(0, 150) || "" })),
  )

  // 4. UPSERT into user_style_profiles
  await env.DB.prepare(
    `INSERT INTO user_style_profiles (id, user_id, tone_style, sample_snippets, learned_post_count, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
       tone_style = excluded.tone_style,
       sample_snippets = excluded.sample_snippets,
       learned_post_count = excluded.learned_post_count,
       updated_at = datetime('now')`,
  )
    .bind(profileId, userId, learnedTone, sampleSnippets, posts.results.length)
    .run()

  const updatedProfile: UserStyleProfile = {
    id: profileId,
    user_id: userId,
    tone_style: learnedTone,
    sample_snippets: sampleSnippets,
    learned_post_count: posts.results.length,
    updated_at: new Date().toISOString(),
  }

  return {
    profile: updatedProfile,
    message: `${posts.results.length}개의 게시물을 분석하여 선생님 고유의 문체 프로필을 성공적으로 학습/저장했습니다.`,
  }
}

export async function deleteUserStyleProfile(
  env: Env,
  userId: string,
): Promise<{ success: boolean; message: string }> {
  const res = await env.DB.prepare("DELETE FROM user_style_profiles WHERE user_id = ?")
    .bind(userId)
    .run()

  const deleted = (res.meta?.changes ?? 0) > 0
  return {
    success: deleted,
    message: deleted
      ? "저장된 문체 프로필 데이터가 완전히 삭제되었습니다."
      : "삭제할 문체 프로필이 존재하지 않습니다.",
  }
}

export function extractCleanTextFromHtml(html: string): string {
  // 1. Remove script, style, nav, footer, header tags
  let text = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
    .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, "")
    .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, "")
    .replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, "")

  // 2. Remove HTML tags and replace with line breaks
  text = text
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, " ")

  // 3. Decode common HTML entities
  text = text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")

  // 4. Clean extra whitespaces
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)

  return lines.join("\n\n")
}

export function isPrivateOrRestrictedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().trim()
  if (
    host === "localhost" ||
    host === "0.0.0.0" ||
    host === "::1" ||
    host === "[::1]" ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    return true
  }

  // IPv4 regex and range checks
  const ipv4Match = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
  if (ipv4Match) {
    const a = Number(ipv4Match[1])
    const b = Number(ipv4Match[2])
    if (a === 127) return true // 127.0.0.0/8 (Loopback)
    if (a === 10) return true // 10.0.0.0/8 (Private)
    if (a === 172 && b >= 16 && b <= 31) return true // 172.16.0.0/12 (Private)
    if (a === 192 && b === 168) return true // 192.168.0.0/16 (Private)
    if (a === 169 && b === 254) return true // 169.254.0.0/16 (Link-local/Metadata)
    if (a === 100 && b >= 64 && b <= 127) return true // 100.64.0.0/10 (CGNAT)
    if (a === 0 || a >= 224) return true // 0.0.0.0/8 & Multicast/Reserved
  }

  return false
}

export async function learnUserStyleFromUrl(
  env: Env,
  userId: string,
  targetUrl: string,
): Promise<{ profile: UserStyleProfile; message: string; sampleLength: number }> {
  // 1. Validate URL & Prevent SSRF
  let parsed: URL
  try {
    parsed = new URL(targetUrl)
  } catch {
    throw new Error("유효한 웹 URL 형식이 아닙니다. (예: https://blog.naver.com/...)")
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("HTTP 또는 HTTPS 프로토콜 URL만 지원합니다.")
  }

  if (isPrivateOrRestrictedHost(parsed.hostname)) {
    throw new Error("보안 정책상 내부 사설망 및 로컬/메타데이터 주소는 접근할 수 없습니다.")
  }

  // 2. Handle Naver Blog URL redirect / PostView format
  let fetchUrl = targetUrl
  if (parsed.hostname.toLowerCase() === "blog.naver.com") {
    const parts = parsed.pathname.split("/").filter(Boolean)
    if (parts.length >= 2 && !parsed.pathname.includes("PostView.naver")) {
      const blogId = parts[0]
      const logNo = parts[1]
      fetchUrl = `https://blog.naver.com/PostView.naver?blogId=${blogId}&logNo=${logNo}`
    }
  }

  // 3. Fetch HTML Content with 5s Timeout and Content-Type validation
  let html = ""
  try {
    const res = await fetch(fetchUrl, {
      signal: AbortSignal.timeout(5000),
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    })
    if (!res.ok) {
      throw new Error(`해당 URL에서 웹페이지를 불러오지 못했습니다 (HTTP 상태 코드: ${res.status})`)
    }

    const contentType = res.headers.get("content-type") || ""
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml") && !contentType.includes("text/plain")) {
      throw new Error("웹 페이지의 형식(Content-Type)이 HTML이 아닙니다.")
    }

    // Limit read size to 1MB
    const textData = await res.text()
    html = textData.slice(0, 1048576)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "웹 페이지 요청 실패"
    throw new Error(`URL 페치 오류: ${msg}`)
  }

  // 4. Extract Clean Text
  const cleanText = extractCleanTextFromHtml(html)
  if (cleanText.length < 50) {
    throw new Error("해당 URL 본문에서 충분한 텍스트(50자 이상)를 추출하지 못했습니다. 공개된 일반 블로그 글 URL인지 확인해주세요.")
  }

  // 5. Pre-Check PII Detection (CR-2 Security Requirement)
  const piiCheck = detectPII(cleanText)
  if (piiCheck.detected) {
    throw new Error(`[보안 정책 위반] URL 본문에서 직접 식별정보(${piiCheck.categories.join(", ")})가 발견되어 문체 학습이 차단되었습니다.`)
  }

  // Slice maximum 2500 chars for style analysis
  const sampleSnippet = cleanText.slice(0, 2500)

  // 5. Analyze Style with Workers AI
  let learnedTone = "선생님의 다정하고 따뜻한 시선이 담긴 어조로, 아이들의 관찰 행동을 부드럽게 서술합니다."
  try {
    if (env.AI && env.ENVIRONMENT === "production") {
      const aiRes = await env.AI.run("@cf/google/gemma-4-26b-a4b-it", {
        messages: [
          {
            role: "user",
            content: `다음은 선생님이 작성하신 외부 블로그 글 본문입니다.
이 글의 '문체 특징(자주 쓰는 어미 ex: ~했어요, ~했답니다, 어조, 문장 호흡, 분위기, 이모지 활용 스타일)'을 분석하여, 앞으로 글을 쓸 때 적용할 '핵심 문체 작성 가이드라인'을 3~5줄로 간결하게 요약해주세요.

[블로그 본문 샘플]
${sampleSnippet}`,
          },
        ],
        max_completion_tokens: 500,
      })

      if (aiRes.response && aiRes.response.trim().length > 0) {
        learnedTone = aiRes.response.trim()
      }
    }
  } catch {
    learnedTone = "자주 사용하는 어미(~했어요, ~했답니다)를 살린 친근하고 따뜻한 관찰 서술 문체."
  }

  const profileId = generateId("style")
  const sampleData = JSON.stringify([
    { title: `URL 샘플 (${parsed.hostname})`, snippet: sampleSnippet.slice(0, 150) },
  ])

  // 6. UPSERT into user_style_profiles
  await env.DB.prepare(
    `INSERT INTO user_style_profiles (id, user_id, tone_style, sample_snippets, learned_post_count, updated_at)
     VALUES (?, ?, ?, ?, 1, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
       tone_style = excluded.tone_style,
       sample_snippets = excluded.sample_snippets,
       learned_post_count = 1,
       updated_at = datetime('now')`,
  )
    .bind(profileId, userId, learnedTone, sampleData)
    .run()

  const updatedProfile: UserStyleProfile = {
    id: profileId,
    user_id: userId,
    tone_style: learnedTone,
    sample_snippets: sampleData,
    learned_post_count: 1,
    updated_at: new Date().toISOString(),
  }

  return {
    profile: updatedProfile,
    message: `URL 링크(${parsed.hostname})에서 본문(${cleanText.length}자)을 성공적으로 추출하여 선생님 고유의 맞춤 문체 프로필을 학습했습니다!`,
    sampleLength: cleanText.length,
  }
}

