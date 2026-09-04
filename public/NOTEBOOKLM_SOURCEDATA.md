# [종합 백데이터] blog_writer 시스템 설계 및 기술 명세서 (NotebookLM 소스용 v2.3)

본 문서는 Google NotebookLM 및 대규모 언어 모델(LLM)에 원천 소스(Source Data)로 제공하기 위해 작성된 **`blog_writer` (개인용 비공개 MVP / 사진 분석 블로그 글 초안 작성기 v2.3)**의 종합 설계 및 기술 명세서입니다.

---

## 📑 목차 (Table of Contents)

1. [프로젝트 개요 및 제품 범위 (Project Overview & Scope)](#1-프로젝트-개요-및-제품-범위)
2. [핵심 아키텍처 및 기술 스택](#2-핵심-아키텍처-및-기술-스택)
3. [8대 핵심 설계 원칙 (Core Rules CR-1 ~ CR-8)](#3-8대-핵심-설계-원칙-cr-1--cr-8)
4. [서버 전용 5대 상태 머신 모델 (State Machine)](#4-서버-전용-5대-상태-머신-모델)
5. [사진 업로드 및 R2 저장 수명주기](#5-사진-업로드-및-r2-저장-수명주기)
6. [Cloudflare Workflows 15단계 AI 파이프라인](#6-cloudflare-workflows-15단계-ai-파이프라인)
7. [직접 식별정보(PII) 실시간 방어 및 Zero-Retention 정책](#7-직접-식별정보pii-실시간-방어-및-zero-retention-정책)
8. [데이터 보관 및 삭제 기준 매트릭스](#8-데이터-보관-및-삭제-기준-매트릭스)
9. [서버 API 명세서 (API Specifications)](#9-서버-api-명세서)
10. [유지관리 하네스 및 4대 서브에이전트 협업 체계](#10-유지관리-하네스-및-4대-서브에이전트-협업-체계)
11. [비용 예산 및 운영 지표](#11-비용-예산-및-운영-지표)
12. [자주 묻는 질문 및 핵심 Q&A (FAQ)](#12-자주-묻는-질문-및-핵심-qa)

---

## 1. 프로젝트 개요 및 제품 범위

- **프로젝트명:** `blog_writer`
- **설계 버전:** v2.3 (개인용 비공개 MVP)
- **GitHub 저장소:** `https://github.com/Hyungkeun-kim/blog_writer`
- **제품 성격 및 범위:**
  - 개발자 본인이 개인적으로 사용하는 **단일 사용자 비공개 개발 도구(Single-User Private Tool)**입니다.
  - 불특정 다수의 회원가입, 업로드, 공개 게시 기능은 제공하지 않습니다.
  - 업로드된 이미지는 Cloudflare R2와 Workers AI에서 처리되며, 사용자 파일명과 EXIF/GPS 메타데이터는 저장 및 AI 전송 전에 서버에서 완전히 제거합니다.
  - 일반 얼굴 및 인물 사진은 관찰 분석 목적으로 허용하되, 특정인 신원 식별이나 생체 인증에는 사용하지 않습니다.
  - 다중 사용자 격리, 아동·대리인 동의, 국외 이전 고지, 공개 개인정보처리방침은 향후 외부 공개 전환 시 별도 요구사항으로 검토합니다.

---

## 2. 핵심 아키텍처 및 기술 스택

- **컴퓨팅 / API 게이트웨이:** Cloudflare Workers (Node.js 호환 ESM 런타임)
- **비동기 오케스트레이션:** Cloudflare Workflows (15단계 결정적 다단계 실행)
- **메타데이터 & 상태 DB:** **Cloudflare D1 (Serverless SQLite)** (`generation_jobs`, `upload_slots`, `temp_artifacts`, `posts`)
- **AI 추론 엔진:** Cloudflare Workers AI
  - **Vision 분석 (OCR/Scene):** `@cf/meta/llama-3.2-11b-vision-instruct` (병렬도 최대 3장, 150 토큰 제한)
  - **Writer & Quality Editor:** `@cf/google/gemma-4-26b-a4b-it` (Writer/Quality 각각 분리 호출)
- **스토리지:** Cloudflare R2 (Private Bucket, Presigned 미사용, 서버 스트림 경유 쓰기)
- **미사용 / 제외 항목:**
  - `Supabase Postgres`: 현재 MVP 설계에서 제외 (Cloudflare D1으로 대체 완료)
  - `Claude (Anthropic)`: 개인용 MVP 기본 경로에서 비활성화
  - `Cloudflare Vectorize`, `pgvector`: 스타일 학습 기능과 함께 현재 MVP 제외
  - `클라이언트 직접 R2 / DB 쓰기`: 원천 차단

---

## 3. 8대 핵심 설계 원칙 (CR-1 ~ CR-8)

### CR-1. 서버 전용 데이터 생성과 상태 변경
- 브라우저는 오직 인증된 요청과 파일 바이트 전송만 수행합니다.
- 데이터 생성, 수정, 삭제, AI 실행, 상태 전이는 **오직 서버에서만 처리**합니다.
- 클라이언트에 R2 쓰기 키, AI 토큰, 상태 변경 RPC 권한을 절대 제공하지 않습니다.
- 멱등성: 모든 작업에 `unique(user_id, idempotency_key)`를 적용합니다.
- 사용자의 "작업 종료" 클릭은 상태를 직접 바꾸는 것이 아니라 서버에 종료를 요청하는 행위이며, 서버가 삭제 검증을 마친 후 완료 처리합니다.

### CR-2. 다중 이미지 업로드 규격
- 1회 작업당 **3~20장의 사진**을 허용합니다.
- 파일당 최대 10MiB, 허용 포맷은 `image/jpeg`, `image/png`, `image/webp`로 제한합니다.
- **Presigned PUT은 사용하지 않으며**, 브라우저는 서버 업로드 API로 전송합니다.
- 서버는 실제 매직 바이트, 디코딩 검증, 방향 보정 및 재인코딩으로 **EXIF/GPS 메타데이터를 제거한 정규화 이미지**를 생성하여 R2에 저장하고 Vision에 전달합니다.
- 객체 키는 `users/{userId}/jobs/{jobId}/slot_{slotId}` 형태로 서버가 결정적으로 생성합니다.

### CR-3. 사용자 종료와 데이터 보관 (Zero-Retention)
- **정상 완료:** 사용자가 결과 확인 화면(`waiting(user_review)`)에서 "작업 종료"를 요청하면 서버가 최종 글을 저장하고, **R2 원본 사진과 모든 중간 결과를 즉시 영구 삭제**한 후 `completed`로 전환합니다.
- **보관 수명 (TTL):** 원본 사진 및 중간 산출물은 업로드 후 **최대 24시간**이며, 작업 종료 시 즉시 비공개 영구 삭제됩니다.
- 24시간이 지난 미완료 작업은 백그라운드 스케줄러가 `failed(SOURCE_EXPIRED)`로 전환하고 자동 삭제합니다.

### CR-4. 금지된 직접 식별정보(PII) 발견 시 즉시 중단
- Vision 프롬프트는 관찰 가능한 대상, 행동, 장소, 사진 속 문자만 추출하며 감정, 성격, 발달, 가족관계를 추론하지 않습니다.
- 실명, 연락처, 주소, 학교/학원명, 차량번호, 신분증, 계좌번호 등 직접 식별정보는 중단 대상입니다.
- **2회 검사:** 1차(Vision 병합 후), 2차(Quality 검수 후) 서버 내부 정규식으로 검사합니다.
- 식별정보 발견 시 즉시 후속 AI 호출을 중단하고 상태를 `failed(PROHIBITED_IDENTIFIER_DETECTED)`로 바꾸며 원본 사진과 임시 데이터를 즉시 영구 삭제합니다.
- 결과 화면에는 고정된 경고 문구만 표시하고 본문이나 AI 응답을 노출하지 않습니다.

### CR-5. 저비용 AI 호출 규격
- Llama 3.2 Vision: 사진당 1회 호출, 영어 JSON 프롬프트, `max_tokens: 150`, `temperature: 0`.
- Gemma 4 IT: Writer(`temperature: 0.3`, 최대 2,000토큰)와 Quality(`temperature: 0`, 최대 2,000토큰)를 분리 호출.
- 동일 사진의 자동 재시도는 최대 1회로 제한합니다.
- Workflow payload 및 일반 로그에 AI 원문 결과를 기록하지 않습니다.

### CR-6. 15단계 Workflow 오케스트레이션
- 8장 사진 기준 15단계 결정적 파이프라인:
  `init (1)` + `vision_slot_* (8, 최대 3병렬)` + `merge (1)` + `pii_input (1)` + `writer (1)` + `quality (1)` + `pii_output (1)` + `prepare_review (1)` = 총 15단계.
- Workflow 단계 반환값에는 임시 결과의 `artifactId`와 `contentHash`만 포함합니다.

### CR-7. 향후 스타일 학습 기능 (현재 MVP 제외)
- 개인용 사진 초안 생성에는 벡터 검색을 사용하지 않습니다.
- 향후 스타일 학습 재도입 시 BGE-M3 1024차원 재임베딩 및 HNSW 인덱스를 별도 마이그레이션으로 진행합니다.

### CR-8. 개인용 비용 예산 지표
- 사진 20장 × 하루 5건 (하루 최대 100장 기준):
  - Llama Vision: 약 3,800 Neurons/일
  - Gemma Writer & Quality: 약 1,000 Neurons/일
  - **합계:** 약 **4,860 Neurons/일** (Cloudflare Workers AI 무료 할당량 10,000 Neurons/일 내에서 100% 무료 운영 가능)

---

## 4. 서버 전용 5대 상태 머신 모델

시스템 상태는 오직 5개로 제한되며 서버 내부 전이표에 의해서만 변경됩니다.

```
[작업 생성] ───────────► waiting (upload) ◄──────────┐
                              │                       │
                              ▼ (검증 완료)           │ (reupload)
                         processing                   │
                        /     │     \                 │
 (AI완료 & PII통과)   /      │      \ (검증실패)      │
                   ▼          │       ▼               │
         waiting (user_review)│   reupload_required ──┘
                   │          │
 (사용자 종료승인) │          │ (PII발견 / 오류 / 타임아웃)
                   ▼          ▼
               completed    failed
              (Terminal)   (Terminal)
```

| 상태 (Status) | 보조 필드 (`waiting_reason` / `failure_code`) | 설명 및 허용 전이 |
|---|---|---|
| **`waiting`** | `upload` 또는 `user_review` | • 사진 업로드 대기 (`upload`) → `processing`, `reupload_required`, `failed`<br>• 사용자 결과 검토 대기 (`user_review`) → `completed`, `failed` |
| **`processing`** | `progress_stage: vision, writer, qa` | 서버가 업로드 검증, Vision 분석, 초안 작성, PII 검사를 수행 중 → `waiting(user_review)`, `reupload_required`, `failed` |
| **`reupload_required`** | `failure_code: DECODE_FAILED, INVALID_SIZE` | 사진 손상, 용량 초과 등으로 재업로드가 필요한 상태 → `waiting(upload)`, `failed` |
| **`completed`** | (Terminal - 최종 종료) | 사용자가 종료를 승인하고 원본 사진 및 임시 데이터의 영구 삭제가 검증된 상태 |
| **`failed`** | `failure_code: PII_DETECTED, SOURCE_EXPIRED 등` | PII 발견, 오류, 24시간 만료 또는 사용자 취소로 즉시 파기된 상태 |

---

## 5. 사진 업로드 및 R2 저장 수명주기

1. **브라우저 전송:** `PUT /api/jobs/{id}/photos/{slotId}`로 바이너리 전송.
2. **서버 검증 및 정규화:**
   - 10MB 이하, MIME 타입(`image/jpeg`, `image/png`, `image/webp`) 매직 바이트 확인.
   - 디코딩 및 방향 보정 후 재인코딩으로 **EXIF/GPS 메타데이터 제거**.
   - 정규화된 바이트에 대해 새 SHA-256 체크섬 계산.
3. **Private R2 저장:**
   - 객체 키: `users/{userId}/jobs/{jobId}/slot_{slotId}` (사용자 파일명 미포함)
   - `customMetadata`: `{ jobId, slotId, checksum, expiresAt }`
4. **영구 파기 (Zero-Retention):**
   - 사용자 종료 승인(`/finish`) 또는 PII 발견 시 확인된 슬롯의 정확한 R2 객체 키를 즉시 영구 삭제.

---

## 6. Cloudflare Workflows 15단계 AI 파이프라인

```
[Workflow Start]
   │
   ├─► [1. init] ── 모든 슬롯의 소유권 및 R2 객체 존재 확인
   │
   ├─► [2~9. vision_slot_0..N] ── Llama 3.2 Vision 분석 (최대 3개 병렬, max 150토큰)
   │     - 프롬프트: 관찰 대상, 행동, 장소, 보이는 문자만 추출 (감정/이름 배제)
   │
   ├─► [10. merge] ── 슬롯별 관찰 결과 병합
   │
   ├─► [11. pii_input] ── 1차 PII 규칙 검사 (식별정보 발견 시 즉시 중단 및 R2 파기)
   │
   ├─► [12. writer] ── Gemma 4 IT 모델로 블로그 초안 작성 (행동 중심, 익명 라벨)
   │
   ├─► [13. quality] ── Gemma 4 IT 모델로 문체 및 사실 일치 검수
   │
   ├─► [14. pii_output] ── 2차 PII 규칙 검사 (완성 텍스트 식별정보 검사)
   │
   └─► [15. prepare_review] ── 상태를 waiting(user_review)로 변경하고 사용자 알림
[Workflow End]
```

---

## 7. 직접 식별정보(PII) 실시간 방어 및 Zero-Retention 정책

1. **내부 정규식 규칙 검사:**
   - 외부 검사 서비스로 원문을 전송하지 않고 서버 내부에서 검사합니다.
   - 주민등록번호, 연락처, 이메일, 주소, 학교/학원명, 차량번호, 여권/운전면허 번호 등.
2. **탐지 시 조치:**
   - 후속 AI 호출과 저장을 즉시 중단.
   - `failure_code = PROHIBITED_IDENTIFIER_DETECTED` 설정.
   - R2 원본 사진 및 모든 임시 산출물 즉시 영구 삭제.
   - 결과 화면에 고정 경고문 표시:
     > "이름, 연락처 등 직접 식별정보가 발견되어 작업을 중단했습니다. 임시 데이터 삭제를 진행합니다. 식별정보를 가린 사진으로 새 작업을 시작해 주세요."

---

## 8. 데이터 보관 및 삭제 기준 매트릭스

| 데이터 종류 | 정상 보관 기간 | 조기 삭제 조건 | 최대 보관 상한 (TTL) |
|---|---|---|---|
| **원본 사진 (R2)** | 처리와 결과 확인에 필요한 동안 | 사용자 종료(`/finish`), PII 발견, 작업 취소, 실패 | **업로드 후 24시간** |
| **Vision 분석 결과** | 사용자 검토에 필요한 동안 서버 전용 | 사용자 종료, PII 발견, 작업 취소, 실패 | 생성 후 24시간 |
| **Writer/Quality 초안** | 사용자 검토에 필요한 동안 서버 전용 | 사용자 종료, PII 발견, 작업 취소, 실패 | 생성 후 24시간 |
| **최종 완성 글** | 정상 완료 후 보관 | 사용자 본인 삭제 시까지 | 별도 만료 없음 |
| **감사 로그** | `job_id`, 삭제 종류, 시각, 성공 여부만 기록 (사진·본문·PII 미포함) | 정책 만료 | 기본 7일 |

---

## 9. 서버 API 명세서

| 메서드 | 엔드포인트 경로 | 설명 | 주요 동작 |
|---|---|---|---|
| `POST` | `/api/jobs` | 작업 및 슬롯 생성 | Body: `{ slotCount, idempotencyKey }` → 상태: `waiting(upload)` |
| `PUT` | `/api/jobs/{id}/photos/{slotId}` | 사진 검증 및 R2 저장 | EXIF 제거 재인코딩, 해시 계산 후 Private R2 저장 |
| `POST` | `/api/jobs/{id}/start` | 파이프라인 처리 시작 | 전체 슬롯 검증 후 Workflows 트리거 → 상태: `processing` |
| `POST` | `/api/jobs/{id}/reupload` | 실패 슬롯 초기화 | 손상 슬롯 재업로드 대기 전환 |
| `GET` | `/api/jobs/{id}` | 작업 상태 실시간 조회 | 상태(`status`), 사유(`waitingReason`), 진행단계 반환 |
| `GET` | `/api/jobs/{id}/result` | 생성된 초안 조회 | `waiting(user_review)` 상태일 때만 복호화하여 반환 |
| `POST` | `/api/jobs/{id}/finish` | 사용자 명시적 종료 & 영구 삭제 | 최종 글 저장 + **R2 원본/임시데이터 즉시 영구 삭제** → `completed` |
| `POST` | `/api/jobs/{id}/cancel` | 작업 취소 및 즉시 폐기 | 즉시 모든 데이터 영구 파기 → `failed(USER_CANCELLED)` |

---

## 10. 유지관리 하네스 및 4대 서브에이전트 협업 체계

| 서브에이전트 ID | 역할 (Role) | 핵심 점검 항목 |
|---|---|---|
| **`blog_writer_architect`** | 시스템 아키텍트 | CR-1 상태 머신 무결성, 멱등성 및 API 규격 심사 |
| **`blog_writer_security`** | 보안 & PII 감사 | CR-2 PII 탐지 규칙, Zero-Retention 즉시 삭제, 24시간 TTL 심사 |
| **`blog_writer_implementer`** | 워크플로우 & AI 구현 | Workers, Workflows, Workers AI, R2 비즈니스 로직 개발 |
| **`blog_writer_qa`** | 기술 QA & 릴리스 게이트 | `pnpm run verify`, 단위 테스트, 무결성 검증 및 릴리스 게이트 심사 |

- **검증 명령어:** `pnpm run verify` (Lint + 상태머신 테스트 + PII 테스트 + 하네스 테스트)

---

## 11. 비용 예산 및 운영 지표

- **1일 최대 가정 (사진 20장 × 5건 = 100장):**
  - Llama 3.2 Vision (100장): 약 3,800 Neurons/일
  - Gemma 4 Writer & Quality (5회): 약 1,000 Neurons/일
  - **합계:** 약 **4,860 Neurons/일** (Cloudflare Workers AI 무료 한도 10,000 Neurons/일의 48% 수준으로 100% 무료 운영)
- **동시 활성 스토리지:** 24시간 이내 영구 삭제로 동시 보관량 300MB 이하 유지.

---

## 12. 자주 묻는 질문 및 핵심 Q&A (FAQ)

### Q1. 아이들의 사진이 인터넷에 유출되거나 남을 위험이 있나요?
> **A:** 전혀 없습니다. 사진은 인터넷에서 직접 접근할 수 없는 Cloudflare R2 **Private 버킷**에만 격리되며, 사용자가 [작업 종료]를 승인하는 즉시 **비공개 영구 삭제(Zero-Retention)**됩니다.

### Q2. AI가 아이들의 감정이나 성격을 임의로 추론하나요?
> **A:** 아닙니다. 프롬프트에 "감정, 성격, 발달, 가족관계 추론 금지"가 엄격히 적용되어 있으며, "노란 연필을 쥐고 글씨를 썼다"와 같이 **눈에 보이는 객관적 행동만으로 서술**합니다.

### Q3. 실수로 브라우저를 닫고 나가면 사진이 계속 남나요?
> **A:** 남지 않습니다. 모든 사진은 최대 24시간의 `expires_at`을 가지며, 백그라운드 스케줄러가 만료된 데이터를 자동 영구 파기합니다.

### Q4. Claude나 외부 유료 모델 비용이 발생하나요?
> **A:** 발생하지 않습니다. 개인용 MVP에서는 Claude가 비활성화되어 있으며, Cloudflare Workers AI 무료 티어 내에서 최적화 동작합니다.
