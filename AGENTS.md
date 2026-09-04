# blog_writer Codex 및 Subagent 작업 규칙

> **필수 원칙:** 시스템 구현, 상태·저장·AI·PII 변경과 릴리스 심사는 하네스 구조의 전문 서브에이전트 검토를 거친다.

## 1. 문서 권위와 제품 범위

- 제품 동작은 `PRD.md`, 보안 경계는 `SECURITY-PRIVACY.md`, 구현 계약은 `TECH-DESIGN.md` v3.0 TARGET을 따른다.
- TARGET은 구현 완료나 배포 승인을 뜻하지 않는다.
- 현재 제품은 소유자 1명이 사용하는 개인용 비공개 도구이며 외부 공개 서비스가 아니다.
- 참고 자료가 핵심 문서와 충돌하면 핵심 문서를 우선한다.

## 2. 필수 아키텍처 규칙

### CR-1. 인증과 서버 전용 제어

- 호출 경계는 `Browser → Firebase Auth → Cloud Run BFF → Cloudflare Worker → D1/R2/Workers AI/Workflows`로 고정한다.
- BFF는 Firebase ID token을 검증하고 정확한 소유자 이메일 allowlist만 허용한다.
- 브라우저는 Worker, D1, R2와 AI를 직접 호출하지 않는다.
- Worker는 BFF의 내부 service token이 없는 인터넷 직접 호출을 거부한다.
- 기본 PIN, 하드코딩·fallback token과 접두사 일치 인증을 금지한다.
- Job, 저장소 객체와 상태는 서버만 생성·변경·삭제한다.
- 모든 쿼리와 객체 접근은 검증된 owner ID와 소유권을 확인한다.
- 작업과 결정 요청은 멱등하게 처리한다.

상태는 다음 다섯 개만 사용한다.

- `waiting` — `waiting_reason: upload | pii_review | final_review`
- `processing`
- `reupload_required`
- `completed`
- `failed`

`completed`는 최종 저장 확인과 임시 데이터 삭제 검증 후 finalization 함수만 설정한다.

### CR-2. 사진과 PII

- 브라우저는 원본을 긴 변 최대 2048px, WebP 품질 0.82로 재인코딩하고 정규화 바이트만 전송한다.
- BFF/Worker는 WebP magic, 실제 디코딩, 크기·치수와 metadata 부재를 다시 확인한다.
- 검증된 정규화 이미지만 R2와 Workers AI Vision에 전달한다.
- 일반 얼굴·인물은 허용하지만 얼굴 식별·생체 인증·얼굴 마스킹을 구현했다고 주장하지 않는다.
- PII는 Vision 파생 텍스트를 Writer에 전달하기 전, Quality 결과를 후보로 표시하기 전, 사용자가 편집한 Markdown을 최종 저장하기 전 총 3회 검사한다.
- 탐지 시 `waiting(pii_review)`에서 사용자에게 계속 또는 취소를 요청한다.
- 입력 단계 계속은 모든 탐지값을 정제하고 재검사한 경우에만 허용한다.
- 출력 단계는 경고와 후보를 표시하고 최종 저장 전에 별도의 acknowledgement와 candidate hash를 확인한다.
- 취소 시 후속 AI를 중단하고 정규화 이미지와 임시 산출물을 삭제한다.
- 탐지 원문, 사진, 프롬프트와 AI 응답 본문을 일반 로그에 남기지 않는다.

### CR-3. 저장과 수명주기

- D1: Job·slot 메타데이터, 상태, 설정, usage, 최종 글 메타데이터
- R2: 정규화 이미지, 임시 artifact, 최종 Markdown
- D1에 AI 중간 본문이나 최종 Markdown 본문을 중복 저장하지 않는다.
- 정규화 이미지와 임시 artifact는 생성 후 최대 24시간이며 완료·취소 시 더 일찍 삭제한다.
- 모든 비종료 Job은 생성 시 확정한 절대 만료를 넘길 수 없고, 만료 시 임시 데이터와 PII 임시 필드를 삭제한다.
- 최종 Markdown과 최소 메타데이터는 사용자가 삭제할 때까지 보관한다.
- 최종화는 R2 Markdown 및 D1 pending 준비 → 임시 삭제 → 잔존 검증 → completed와 visible 전환 순서를 지킨다.
- 삭제 실패는 `cleanup_pending`으로 재시도하며 삭제 확인 전 completed로 전환하지 않는다.
- Workflow deadline, 실제 배포된 Cron과 R2 Lifecycle 안전망을 함께 검증한다.

### CR-4. AI·설정·사용량

- Vision: Llama 3.2 Vision 기본, Llama 4 Scout 대안
- Writer·Quality: Gemma 4 기본, GLM 4.7 Flash 대안
- 서버 allowlist 밖의 모델과 Claude 등 추가 provider는 MVP에서 비활성화한다.
- Writer와 Quality는 별도 단계로 실행한다.
- 설정은 allowlist와 안전 범위를 검증하고 Job 생성 시 snapshot을 저장한다.
- 임시 보관은 1~24시간, 사진 크기는 최대 10MiB를 넘을 수 없다.
- usage는 UTC 날짜와 모델·단계별로 actual/estimated를 구분한다.
- 70%와 90% 경고를 표시하되 개인용 MVP에서는 작업을 강제 차단하지 않는다.
- cleanup과 삭제는 사용량 경고와 관계없이 항상 허용한다.

### CR-5. MVP 제외

- 문체 학습, 외부 URL 수집, pgvector와 Vectorize
- 다중 사용자 가입, 결제와 공개 게시
- 외부 사용자용 동의·철회·개인정보처리방침

레거시 코드가 존재해도 UI와 공개 API에서 비활성화하고 현재 제공 기능으로 문서화하지 않는다.

### CR-6. UI 진실성

- 증빙 없이 `100%`, `1초`, `영구 소각`, `Zero-Retention`, `보장`을 사용하지 않는다.
- 임시 데이터 최대 24시간과 최종 Markdown의 사용자 삭제 시까지 보관을 구분해 표시한다.
- 일반 사용자가 이해할 수 있는 한국어를 사용하고 내부 ID·binding·secret은 노출하지 않는다.
- 구현·테스트·배포 증빙이 모두 있을 때만 기능을 활성 또는 완료로 표시한다.

## 3. 역할

| 역할 | 책임 | 승인 |
|---|---|---|
| Orchestrator | 계획, 컨텍스트, 역할 조율 | 진행 승인 |
| System Architect | 인증 경계, 상태, API, D1/R2 계약 | 아키텍처 승인 |
| Security & PII Auditor | Firebase/BFF, PII, 로그, 보관·삭제 | 보안 승인 |
| Workflow & AI Implementer | Worker, Workflows, R2, Workers AI | 구현 보고 |
| Technical QA & Release Gate | 단위·통합·배포 검증 | 최종 승인 |

구현 담당자는 자신의 변경을 최종 승인하지 않는다. 인증, 상태, 저장, PII, AI 전송, 삭제 또는 공개 배포 변경은 최소 System Architect, Security & PII Auditor와 Technical QA의 독립 검토가 필요하다.

## 4. 하네스 운영

1. `maintenance/changes/<작업-ID>/context-*.json`에 최소 컨텍스트를 제공한다.
2. 런타임 코드나 배포 후보가 바뀌면 새로운 `candidate_hash`를 생성한다.
3. 영향 역할은 같은 candidate hash를 검토한다.
4. 개인용 개발 단계는 `pnpm run verify`, 외부 공개 전은 강화된 `release:gate`를 사용한다.
5. 보고서 경고나 누락이 있는데도 release gate가 성공하면 게이트 결함으로 처리한다.

## 5. 필수 검증

```bash
pnpm run verify
pnpm run build
pnpm run release:gate -- maintenance/changes/<CHANGE_ID>/manifest.json
```

릴리스 게이트에는 다음 증빙이 포함되어야 한다.

- Firebase owner 인증과 BFF/Worker 직접 호출 차단
- 정규화 WebP와 서버 검증
- PII 계속·취소·최종 acknowledgement
- pending → purge → 잔존 검증 → completed
- 완료·취소·실패·24시간 만료·최종 글 삭제
- 설정 allowlist와 Job snapshot
- UTC 일별 usage와 70%·90% 경고
- 사진·프롬프트·AI 응답·PII 원문 로그 부재
