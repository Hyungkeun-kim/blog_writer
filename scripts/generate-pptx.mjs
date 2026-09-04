import pptxgen from "pptxgenjs"

const pptx = new pptxgen()
pptx.layout = "LAYOUT_16x9"
pptx.author = "Antigravity AI"
pptx.company = "blog_writer Project"
pptx.title = "blog_writer 시스템 아키텍처 및 프로세스 맵"

// 색상 팔레트
const COLORS = {
  bgLight: "F8FAFC",
  primary: "1E3A8A",    // Deep Blue
  primaryLight: "3B82F6",
  accent: "0D9488",     // Teal
  danger: "E11D48",     // Rose Red
  warning: "D97706",    // Amber
  cardBg: "FFFFFF",
  cardBorder: "CBD5E1",
  textDark: "0F172A",
  textMuted: "64748B",
  white: "FFFFFF"
}

// ----------------------------------------------------
// 슬라이드 1: 표지 (Title Slide)
// ----------------------------------------------------
const slide1 = pptx.addSlide()
slide1.background = { color: COLORS.primary }

slide1.addText("blog_writer", {
  x: 1.0,
  y: 1.8,
  w: 11.3,
  h: 0.9,
  fontSize: 46,
  fontFace: "Arial",
  bold: true,
  color: COLORS.white,
})

slide1.addText("시스템 아키텍처 및 프로세스 맵 (Process Map)", {
  x: 1.0,
  y: 2.8,
  w: 11.3,
  h: 0.6,
  fontSize: 24,
  fontFace: "Arial",
  color: "93C5FD",
})

slide1.addText("사진 분석 기반 AI 블로그 글 초안 작성 도우미 (v2.2)\nCloudflare Workers · Workflows · Workers AI · Supabase Postgres & pgvector · R2 Private", {
  x: 1.0,
  y: 4.0,
  w: 11.3,
  h: 1.2,
  fontSize: 16,
  fontFace: "Arial",
  color: "E2E8F0",
  lineSpacing: 26,
})

slide1.addText("작성일: 2026. 09. 01 | blog_writer 프로젝트 팀", {
  x: 1.0,
  y: 6.2,
  w: 11.3,
  h: 0.4,
  fontSize: 12,
  fontFace: "Arial",
  color: "94A3B8",
})

// ----------------------------------------------------
// 슬라이드 2: 핵심 설계 원칙 (Core Rules)
// ----------------------------------------------------
const slide2 = pptx.addSlide()
slide2.background = { color: COLORS.bgLight }

slide2.addText("핵심 설계 원칙 (Core Rules)", {
  x: 0.8,
  y: 0.6,
  w: 11.7,
  h: 0.6,
  fontSize: 24,
  fontFace: "Arial",
  bold: true,
  color: COLORS.primary,
})

const cardWidth = 5.6
const cardHeight = 2.5
const cards = [
  {
    title: "CR-1. 서버 전용 데이터 & 상태 제어",
    desc: "• 클라이언트의 직접 DB/R2 쓰기 및 RPC 호출 차단\n• 5대 상태 머신(waiting, processing 등) 엄격 통제\n• unique(user_id, idempotency_key) 멱등성 보장",
    x: 0.8, y: 1.4, color: COLORS.primaryLight
  },
  {
    title: "CR-2. PII 탐지 & 즉시 삭제 (Zero Retention)",
    desc: "• 서버 내부 정규식 규칙 기반 PII 실시간 검사\n• PII 발견 시 즉시 중단 및 원본/중간 데이터 영구 삭제\n• 사진 R2 최대 24시간 보관 및 사용자 종료 시 즉시 파기",
    x: 6.8, y: 1.4, color: COLORS.danger
  },
  {
    title: "CR-3. 저비용 고효율 AI 파이프라인",
    desc: "• Vision: Llama 3.2 11B Vision Instruct\n• Writer & QA: Gemma 4 26B A4B IT\n• Cloudflare Workers AI 일일 무료 티어 내 최적화",
    x: 0.8, y: 4.2, color: COLORS.accent
  },
  {
    title: "CR-4. 사용자 명시적 종료 기반 완료",
    desc: "• AI 처리 완료는 완료 상태가 아님 (대기 상태 유지)\n• 사용자가 결과 확인 후 '종료' 요청 시 최종 승인\n• 최종 저장과 동시에 R2/중간 산출물 즉시 삭제",
    x: 6.8, y: 4.2, color: COLORS.warning
  }
]

cards.forEach(c => {
  slide2.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
    x: c.x, y: c.y, w: cardWidth, h: cardHeight,
    fill: { color: COLORS.cardBg },
    line: { color: COLORS.cardBorder, width: 1.5 },
    rectRadius: 0.1
  })
  slide2.addText(c.title, {
    x: c.x + 0.3, y: c.y + 0.3, w: cardWidth - 0.6, h: 0.4,
    fontSize: 16, fontFace: "Arial", bold: true, color: c.color
  })
  slide2.addText(c.desc, {
    x: c.x + 0.3, y: c.y + 0.8, w: cardWidth - 0.6, h: 1.5,
    fontSize: 13, fontFace: "Arial", color: COLORS.textDark, lineSpacing: 22
  })
})

// ----------------------------------------------------
// 슬라이드 3: 엔드투엔드 수명주기 프로세스 (End-to-End Lifecycle)
// ----------------------------------------------------
const slide3 = pptx.addSlide()
slide3.background = { color: COLORS.bgLight }

slide3.addText("엔드투엔드(End-to-End) 처리 수명주기", {
  x: 0.8, y: 0.6, w: 11.7, h: 0.6,
  fontSize: 24, fontFace: "Arial", bold: true, color: COLORS.primary
})

const steps = [
  { step: "1", name: "작업 생성", sub: "POST /api/jobs\n슬롯 발급\nDB 레코드 생성" },
  { step: "2", name: "사진 업로드 & 검증", sub: "PUT /photos/{slot}\n서버 바이트/해시 검사\nPrivate R2 안전 저장" },
  { step: "3", name: "Workflow 파이프라인", sub: "Llama 3.2 Vision 분석\nGemma 4 초안 작성\nPII 실시간 검사" },
  { step: "4", name: "사용자 검토 & 종료", sub: "GET /result 확인\nPOST /finish 명시적 종료" },
  { step: "5", name: "즉시 데이터 삭제", sub: "R2 원본 사진 영구 삭제\ntemp_artifacts 즉시 파기\nZero-Retention 완료" }
]

const stepW = 2.15
const stepGap = 0.25
steps.forEach((s, idx) => {
  const sx = 0.8 + idx * (stepW + stepGap)
  slide3.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
    x: sx, y: 1.6, w: stepW, h: 4.8,
    fill: { color: COLORS.cardBg },
    line: { color: idx === 4 ? COLORS.danger : COLORS.primaryLight, width: 2 },
    rectRadius: 0.1
  })
  slide3.addShape(pptx.shapes.OVAL, {
    x: sx + (stepW - 0.7) / 2, y: 1.9, w: 0.7, h: 0.7,
    fill: { color: idx === 4 ? COLORS.danger : COLORS.primary },
    line: { color: COLORS.white, width: 1 }
  })
  slide3.addText(s.step, {
    x: sx + (stepW - 0.7) / 2, y: 2.0, w: 0.7, h: 0.5,
    fontSize: 16, fontFace: "Arial", bold: true, color: COLORS.white, align: "center"
  })
  slide3.addText(s.name, {
    x: sx + 0.1, y: 2.8, w: stepW - 0.2, h: 0.6,
    fontSize: 14, fontFace: "Arial", bold: true, color: COLORS.textDark, align: "center"
  })
  slide3.addText(s.sub, {
    x: sx + 0.15, y: 3.5, w: stepW - 0.3, h: 2.6,
    fontSize: 12, fontFace: "Arial", color: COLORS.textMuted, align: "center", lineSpacing: 20
  })
})

// ----------------------------------------------------
// 슬라이드 4: 서버 전용 5대 상태 머신 (State Machine)
// ----------------------------------------------------
const slide4 = pptx.addSlide()
slide4.background = { color: COLORS.bgLight }

slide4.addText("서버 전용 5대 상태 머신 (State Machine)", {
  x: 0.8, y: 0.6, w: 11.7, h: 0.6,
  fontSize: 24, fontFace: "Arial", bold: true, color: COLORS.primary
})

const stateRows = [
  [
    { text: "상태 (Status)", options: { bold: true, fill: { color: "E2E8F0" } } },
    { text: "세부 사유 (Reason / Stage)", options: { bold: true, fill: { color: "E2E8F0" } } },
    { text: "설명 및 허용 전이", options: { bold: true, fill: { color: "E2E8F0" } } }
  ],
  [
    { text: "waiting", options: { bold: true, color: COLORS.primaryLight } },
    { text: "upload | user_review" },
    { text: "사진 업로드 대기 또는 사용자 결과 확인 대기 중\n→ processing, reupload_required, completed(user_review시), failed" }
  ],
  [
    { text: "processing", options: { bold: true, color: COLORS.accent } },
    { text: "upload_verify | vision | writer | qa" },
    { text: "서버가 업로드 검증, Vision 분석, 글 작성 및 PII 검사 진행 중\n→ waiting(user_review), reupload_required, failed" }
  ],
  [
    { text: "reupload_required", options: { bold: true, color: COLORS.warning } },
    { text: "DECODE_FAILED | INVALID_SIZE 등" },
    { text: "사진 손상, 규격 미달 등으로 재업로드가 필요한 상태\n→ waiting(upload), failed" }
  ],
  [
    { text: "completed", options: { bold: true, color: COLORS.primary } },
    { text: "Terminal (최종 완료)" },
    { text: "사용자가 종료 승인하여 최종 포스트 저장 및 원본 삭제 완료\n(다른 상태로 전이 불가)" }
  ],
  [
    { text: "failed", options: { bold: true, color: COLORS.danger } },
    { text: "PII_DETECTED | TIMEOUT 등" },
    { text: "PII 발견 또는 치명적 오류로 즉시 중단 및 원본/임시 데이터 영구 삭제\n(다른 상태로 전이 불가)" }
  ]
]

slide4.addTable(stateRows, {
  x: 0.8, y: 1.5, w: 11.7,
  colW: [2.5, 3.2, 6.0],
  fill: { color: COLORS.cardBg },
  border: { color: COLORS.cardBorder, pt: 1 },
  fontFace: "Arial",
  fontSize: 12,
  color: COLORS.textDark,
  align: "left",
  valign: "middle",
  rowH: [0.5, 0.9, 0.9, 0.8, 0.8, 0.8],
  autoPage: false
})

// ----------------------------------------------------
// 슬라이드 5: 보안 및 PII 실시간 방어 체계
// ----------------------------------------------------
const slide5 = pptx.addSlide()
slide5.background = { color: COLORS.bgLight }

slide5.addText("보안 및 개인정보(PII) 실시간 방어 체계", {
  x: 0.8, y: 0.6, w: 11.7, h: 0.6,
  fontSize: 24, fontFace: "Arial", bold: true, color: COLORS.primary
})

const piiCols = [
  {
    title: "1. 규칙 기반 실시간 탐지",
    items: [
      "• 주민등록번호, 연락처, 이메일, 여권, 운전면허 등 정규식 패턴 검사",
      "• AI 모델에 원본 텍스트를 전송하지 않고 서버 내부 검사 수행",
      "• OCR / Vision 결과 및 AI 생성 초안 전체에 필터링 적용"
    ],
    x: 0.8, y: 1.5, w: 5.6, h: 4.9, color: COLORS.primaryLight
  },
  {
    title: "2. 즉시 격리 및 영구 삭제",
    items: [
      "• PII 발견 즉시 failed 상태 전환 및 pii_incidents에 유형만 기록",
      "• Private R2 버킷의 모든 원본 사진 파일 즉시 영구 삭제",
      "• temp_artifacts 테이블의 모든 암호화 중간 결과 즉각 파기",
      "• 최대 24시간 수명주기(TTL) 강제로 미종료 사진도 자동 소멸"
    ],
    x: 6.8, y: 1.5, w: 5.6, h: 4.9, color: COLORS.danger
  }
]

piiCols.forEach(col => {
  slide5.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
    x: col.x, y: col.y, w: col.w, h: col.h,
    fill: { color: COLORS.cardBg },
    line: { color: col.color, width: 2 },
    rectRadius: 0.1
  })
  slide5.addText(col.title, {
    x: col.x + 0.4, y: col.y + 0.4, w: col.w - 0.8, h: 0.5,
    fontSize: 16, fontFace: "Arial", bold: true, color: col.color
  })
  slide5.addText(col.items.join("\n\n"), {
    x: col.x + 0.4, y: col.y + 1.1, w: col.w - 0.8, h: 3.4,
    fontSize: 13, fontFace: "Arial", color: COLORS.textDark, lineSpacing: 22
  })
})

// ----------------------------------------------------
// 슬라이드 6: 하네스 및 4대 서브에이전트 협업 체계
// ----------------------------------------------------
const slide6 = pptx.addSlide()
slide6.background = { color: COLORS.bgLight }

slide6.addText("유지관리 하네스 & 서브에이전트 협업 체계", {
  x: 0.8, y: 0.6, w: 11.7, h: 0.6,
  fontSize: 24, fontFace: "Arial", bold: true, color: COLORS.primary
})

const agents = [
  { role: "blog_writer_architect", title: "시스템 아키텍트", desc: "CR-1 상태 머신 무결성, DB 스키마, 멱등성 및 API 규격 심사" },
  { role: "blog_writer_security", title: "보안 & PII 감사", desc: "CR-2 PII 탐지 규칙, 즉시 삭제(Zero-retention), R2 수명주기 심사" },
  { role: "blog_writer_implementer", title: "워크플로우 & AI 구현", desc: "Cloudflare Workers, Workflows, Workers AI, R2, Supabase 기능 개발" },
  { role: "blog_writer_qa", title: "기술 QA & 릴리스 게이트", desc: "정적 검사(Lint), 상태/PII 테스트, 하네스 심사 및 최종 릴리스 승인" }
]

agents.forEach((ag, idx) => {
  const ax = 0.8 + (idx % 2) * 6.0
  const ay = 1.5 + Math.floor(idx / 2) * 2.6
  slide6.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
    x: ax, y: ay, w: 5.7, h: 2.3,
    fill: { color: COLORS.cardBg },
    line: { color: COLORS.cardBorder, width: 1.5 },
    rectRadius: 0.1
  })
  slide6.addText(`${ag.title} (${ag.role})`, {
    x: ax + 0.3, y: ay + 0.3, w: 5.1, h: 0.4,
    fontSize: 15, fontFace: "Arial", bold: true, color: COLORS.primary
  })
  slide6.addText(ag.desc, {
    x: ax + 0.3, y: ay + 0.8, w: 5.1, h: 1.2,
    fontSize: 13, fontFace: "Arial", color: COLORS.textDark, lineSpacing: 22
  })
})

// 저장 실행
const outputPath = "/home/devkorea/blog_writer/blog_writer_process_map.pptx"
pptx.writeFile({ fileName: outputPath }).then(fileName => {
  console.log(`PPTX file successfully generated at: ${fileName}`)
}).catch(err => {
  console.error("Failed to generate PPTX:", err)
  process.exit(1)
})
