# blog_writer

사진을 바탕으로 개인용 블로그 글 초안을 만드는 **소유자 1인용 비공개 도구**입니다.

> 설계 기준: **v3.0 TARGET**
> 이 저장소에는 목표 설계가 아직 구현되지 않은 코드가 포함되어 있습니다. 문서의 `TARGET`은 구현 완료나 배포 승인을 의미하지 않습니다.

## 목표 구조

```text
브라우저
  ├─ Firebase Google 로그인
  ├─ 원본 사진을 2048px 이하 WebP(q=0.82)로 정규화
  └─ Firebase ID token + 정규화 사진 전송
          ↓
Cloud Run BFF
  ├─ Firebase token 검증
  ├─ 소유자 이메일 allowlist 확인
  └─ 서버 간 자격증명으로 Worker 호출
          ↓
Cloudflare Worker / Workflows
  ├─ D1: 작업·설정·사용량·최종 글 메타데이터
  ├─ R2: 정규화 사진·임시 산출물·최종 Markdown
  └─ Workers AI: Vision·Writer·Quality
```

브라우저는 Cloudflare Worker, D1, R2 또는 Workers AI를 직접 호출하지 않습니다. 기본 PIN, 공개 토큰, 접두사만 검사하는 토큰은 허용하지 않습니다.

## 제품 원칙

- 현재 단계는 외부 서비스가 아닌 개발자 개인용 MVP입니다.
- 로컬 원본 파일은 기기를 벗어나지 않습니다. 브라우저가 방향을 반영해 긴 변 최대 2048px, WebP 품질 0.82로 재인코딩한 사진만 전송합니다.
- 정규화 사진은 Cloudflare R2와 Workers AI에서 처리될 수 있음을 화면에 알립니다.
- 일반 얼굴·인물 사진은 허용하지만 얼굴 식별, 생체 인증, 얼굴 마스킹을 수행한다고 주장하지 않습니다.
- PII 탐지는 보조 안전장치입니다. 탐지 시 사용자가 계속하거나 취소할 수 있으며, 최종 저장은 별도 확인이 필요합니다.
- 정규화 사진과 임시 산출물은 최대 24시간 보관하고 완료·취소 시 더 일찍 삭제합니다.
- 최종 Markdown과 최소 메타데이터는 사용자가 삭제할 때까지 보관합니다.
- 측정 근거 없이 `100% 차단`, `1초 삭제`, `Zero-Retention 보장`, `영구 소각`이라고 표시하지 않습니다.

## AI와 설정

- Vision 기본: Llama 3.2 Vision, 선택 가능 모델: Llama 4 Scout
- Writer·Quality 기본: Gemma 4, 선택 가능 모델: GLM 4.7 Flash
- 모델은 서버 allowlist 안에서만 선택할 수 있습니다.
- 사용량 화면은 UTC 일별 actual/estimated 값을 구분하고, 실제값을 얻을 수 없을 때만 로컬 추정치를 표시하며 70%와 90%에서 경고합니다. 실제 과금·할당량은 Cloudflare Dashboard가 최종 기준입니다.
- 설정 화면은 이미 연결된 리소스와 마스킹된 상태만 보여줍니다. Cloudflare 리소스 생성·삭제·재연결이나 secret 원문 표시는 제공하지 않습니다.
- 문체 학습과 외부 URL 수집은 현재 MVP 범위에서 제외합니다.

## 현재 구현 상태

현재 코드는 목표 구조를 완성하지 않았습니다. 특히 다음 항목은 배포 승인 전 수정해야 합니다.

- Firebase 로그인과 Cloud Run BFF가 없고 개발용 토큰 인증이 남아 있음
- 서버가 정규화 WebP의 실제 디코딩·치수·메타데이터를 완전 검증하지 않음
- PII 계속 처리와 최종 확인 흐름이 목표 계약과 다름
- 개발 모드에서 Workflows 대신 직접 실행·샘플 fallback이 사용될 수 있음
- Quality AI, Cron 배포, 실제 일일 AI 사용량 집계가 완성되지 않음
- 일부 화면에 과도한 보안 보장 및 기술 용어가 남아 있음

## 기준 문서

- [제품 요구사항](PRD.md)
- [보안·개인정보 기준](SECURITY-PRIVACY.md)
- [기술 설계](TECH-DESIGN.md)
- [에이전트 작업 규칙](AGENTS.md)

`PROCESS-MAP.md`와 `NOTEBOOKLM_SOURCEDATA.md`는 참고 자료이며, 내용이 충돌하면 위 네 문서의 v3.0 TARGET을 우선합니다.

## 개발 검증

```bash
pnpm install
pnpm run verify
pnpm run build
```

외부 공개 전에는 Firebase 소유자 인증, Worker 직접 호출 차단, PII 3개 검사 시점과 continue/cancel 결정 경로, 24시간 삭제, 최종 글 삭제 및 실제 Workers AI 사용량을 포함한 통합 테스트와 독립 보안·QA 승인이 필요합니다.
