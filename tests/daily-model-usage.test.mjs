import test from "node:test"
import assert from "node:assert/strict"

test("Daily Model Usage - Computes percent used and warning levels per TECH-DESIGN v3.0", () => {
  function computeUsageMetrics(totalNeurons) {
    const dailyQuota = 10000
    const percentUsed = Math.min(100, Math.round((totalNeurons / dailyQuota) * 100))
    let warningLevel = "normal"
    let warningMessage = "일일 무료 사용량이 안정적인 수준입니다."

    if (percentUsed >= 90) {
      warningLevel = "warning"
      warningMessage = "강한 경고: 일일 참고 한도의 90%를 초과했습니다."
    } else if (percentUsed >= 70) {
      warningLevel = "caution"
      warningMessage = "주의: 일일 참고 한도의 70%에 도달했습니다."
    }

    return {
      totalNeurons,
      dailyQuotaNeurons: dailyQuota,
      percentUsed,
      warningLevel,
      warningMessage,
      disclaimer: "실제 청구와 무료 할당량은 Cloudflare Dashboard가 최종 기준입니다.",
    }
  }

  // Normal (< 70%)
  const m1 = computeUsageMetrics(5000)
  assert.equal(m1.percentUsed, 50)
  assert.equal(m1.warningLevel, "normal")

  // Caution (>= 70%)
  const m2 = computeUsageMetrics(7500)
  assert.equal(m2.percentUsed, 75)
  assert.equal(m2.warningLevel, "caution")
  assert.match(m2.warningMessage, /70%/)

  // Warning (>= 90%)
  const m3 = computeUsageMetrics(9200)
  assert.equal(m3.percentUsed, 92)
  assert.equal(m3.warningLevel, "warning")
  assert.match(m3.warningMessage, /90%/)

  // Disclaimer check
  assert.match(m3.disclaimer, /Cloudflare Dashboard가 최종 기준/)
})
