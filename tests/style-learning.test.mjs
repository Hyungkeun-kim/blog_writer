import test from "node:test"
import assert from "node:assert/strict"

// Pure JS Implementation of Style Learning logic for unit verification
function parseLearnedTone(aiResponse) {
  if (typeof aiResponse === "string" && aiResponse.trim().length > 0) {
    return aiResponse.trim()
  }
  return "자주 사용하는 어미(~했어요, ~했답니다)를 살린 친근하고 따뜻한 관찰 서술 문체."
}

function buildStylePrompt(baseGuide, userStyle) {
  let guide = baseGuide
  if (userStyle && userStyle.tone_style) {
    guide += `\n4. [선생님 고유 맞춤 문체 지침]:\n${userStyle.tone_style}`
  }
  return guide
}

test("On-Demand Style Learning - Parse & Format Style Profile", () => {
  const aiOutput = "선생님의 다정하고 따뜻한 어조로, 문장 끝을 '~했어요', '~했답니다'로 맺음."
  const parsedTone = parseLearnedTone(aiOutput)
  assert.equal(parsedTone, aiOutput)

  const defaultTone = parseLearnedTone(null)
  assert.ok(defaultTone.includes("~했답니다"))

  const baseGuide = "1. 아이들의 감정/성격 추론 배제\n2. '아이1, 아이2' 등 익명 라벨 사용\n3. 관찰 가능한 행동 위주의 서술"
  const userStyle = {
    user_id: "teacher_1",
    tone_style: "문장 끝에 항상 따뜻한 칭찬을 덧붙이고, 느낌표(!)를 적절히 사용함.",
    learned_post_count: 3,
  }

  const promptWithStyle = buildStylePrompt(baseGuide, userStyle)
  assert.ok(promptWithStyle.includes("[선생님 고유 맞춤 문체 지침]"))
  assert.ok(promptWithStyle.includes("따뜻한 칭찬"))
})

test("On-Demand Style Learning - Fallback when Profile Missing", () => {
  const baseGuide = "1. 아이들의 감정/성격 추론 배제\n2. '아이1, 아이2' 등 익명 라벨 사용\n3. 관찰 가능한 행동 위주의 서술"
  const promptWithoutStyle = buildStylePrompt(baseGuide, null)
  assert.ok(!promptWithoutStyle.includes("[선생님 고유 맞춤 문체 지침]"))
})

test("On-Demand Style Learning - Profile Deletion and Reset Behavior", () => {
  let profileStore = {
    teacher_1: {
      tone_style: "친절한 말투",
      learned_post_count: 5,
    },
  }

  // Delete profile
  delete profileStore.teacher_1
  assert.equal(profileStore.teacher_1, undefined)

  const baseGuide = "1. 관찰 서술"
  const promptAfterDelete = buildStylePrompt(baseGuide, profileStore.teacher_1)
  assert.equal(promptAfterDelete, baseGuide)
})

test("On-Demand Style Learning - HTML Clean Text Extraction", () => {
  const sampleHtml = `
    <html>
      <head><script>alert('xss');</script><style>.body{color:red}</style></head>
      <body>
        <header><nav>홈 메인 메뉴</nav></header>
        <div class="se-main-container">
          <p>오늘 우리 반 아이들과 함께 블록 쌓기 놀이를 진행했습니다.</p>
          <p>아이들이 서로 양보하며 높은 성을 완성했어요!&nbsp;&amp;&nbsp;정말 멋졌답니다.</p>
        </div>
        <footer>푸터 저작권 정보</footer>
      </body>
    </html>
  `

  let text = sampleHtml
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
    .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, "")
    .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, "")
    .replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, "")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")

  const lines = text.split("\n").map((l) => l.trim()).filter((l) => l.length > 0)
  const clean = lines.join("\n\n")

  assert.ok(!clean.includes("alert"))
  assert.ok(!clean.includes("메인 메뉴"))
  assert.ok(!clean.includes("푸터 저작권"))
  assert.ok(clean.includes("블록 쌓기 놀이"))
  assert.ok(clean.includes("정말 멋졌답니다"))
})

test("On-Demand Style Learning - Comprehensive SSRF Protection on Dangerous URLs", () => {
  const dangerousHosts = [
    "127.0.0.1",
    "127.0.0.2",
    "127.1.2.3",
    "localhost",
    "0.0.0.0",
    "::1",
    "[::1]",
    "10.0.0.1",
    "10.255.255.255",
    "172.16.0.1",
    "172.31.255.254",
    "192.168.0.1",
    "192.168.100.50",
    "169.254.169.254",
    "100.64.0.1",
    "internal.server.local",
  ]

  function isPrivateOrRestrictedHost(hostname) {
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

    const ipv4Match = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
    if (ipv4Match) {
      const a = Number(ipv4Match[1])
      const b = Number(ipv4Match[2])
      if (a === 127) return true
      if (a === 10) return true
      if (a === 172 && b >= 16 && b <= 31) return true
      if (a === 192 && b === 168) return true
      if (a === 169 && b === 254) return true
      if (a === 100 && b >= 64 && b <= 127) return true
      if (a === 0 || a >= 224) return true
    }

    return false
  }

  dangerousHosts.forEach((h) => {
    assert.ok(isPrivateOrRestrictedHost(h), `Host ${h} must be blocked by SSRF filter`)
  })

  const safeHosts = ["blog.naver.com", "tistory.com", "brunch.co.kr", "example.com"]
  safeHosts.forEach((h) => {
    assert.equal(isPrivateOrRestrictedHost(h), false, `Safe host ${h} should not be blocked`)
  })
})

