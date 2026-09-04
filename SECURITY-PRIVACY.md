# 개인용 보안·PII 기준 v3.0

**상태:** TARGET · 미구현 항목 포함

이 문서는 소유자 1명이 사용하는 비공개 MVP의 내부 안전 기준이다. 외부 사용자용 개인정보처리방침이 아니며, 문서에 적힌 통제가 소스·테스트·배포에서 확인되기 전에는 보안 기능이 완료됐다고 표현하지 않는다.

## 1. 신뢰 경계와 인증

```text
Browser → Firebase Auth → Cloud Run BFF → Cloudflare Worker → D1/R2/Workers AI/Workflows
```

- 브라우저는 Google 로그인으로 받은 Firebase ID token만 BFF에 전달한다.
- BFF는 서명, issuer, audience, 만료, 이메일 인증 여부를 검증한다.
- `OWNER_EMAILS`의 정확한 이메일만 허용한다. 필요하면 UID를 함께 고정해 계정 변경을 탐지한다.
- 무효·누락 token은 401, 유효한 비소유자 token은 403이다.
- BFF는 서버 전용 서비스 token으로 Worker를 호출하고 Worker는 이 token이 없는 직접 호출을 거부한다.
- 기본 PIN, 공개된 고정 token, 접두사 일치, 클라이언트 fallback token을 인증으로 사용하지 않는다.
- Firebase 웹 설정은 공개 식별정보일 수 있지만 owner allowlist, BFF↔Worker token, D1/R2/AI 자격증명은 secret이다.
- CORS는 허용된 앱 origin만 승인한다.

## 2. 서버 전용 권한

- 브라우저는 Cloudflare Worker, D1, R2, Workers AI와 Workflows를 직접 호출하지 않는다.
- D1과 R2는 Worker binding을 통해서만 접근한다.
- BFF가 검증한 `owner_id`만 내부 요청에 전달하며 브라우저가 보낸 owner ID를 신뢰하지 않는다.
- 모든 D1 조회·변경과 R2 객체 접근은 `owner_id`, Job 소유권, 현재 상태를 함께 검사한다.
- 상태 변경은 compare-and-set과 내부 전이표로 처리한다.
- Job 생성, PII 결정, 최종 저장, 취소와 삭제 요청은 멱등하게 처리한다.
- 서비스 secret은 환경변수 원문 조회 API나 설정 화면에 노출하지 않는다.

## 3. 사진 처리 경계

- 로컬 원본 파일은 사용자 기기를 벗어나지 않는다.
- 브라우저가 방향을 반영해 긴 변 최대 2048px, WebP 품질 0.82로 재인코딩한다.
- 사용자 파일명, EXIF/GPS와 원본 metadata가 없는 정규화 바이트만 BFF에 전송한다.
- BFF/Worker는 최대 10MiB, WebP magic bytes, 실제 디코딩, 최대 치수와 metadata 부재를 다시 검사한다.
- 클라이언트 전처리 결과를 신뢰하지 않으며 검증 실패 파일은 R2와 AI에 전달하지 않는다.
- 검증된 정규화 이미지만 private R2 임시 영역과 Workers AI Vision에서 처리한다.
- 일반 얼굴·인물 사진은 허용하지만 얼굴 식별, 생체 특징 추출 또는 얼굴 마스킹은 수행하지 않는다.
- 화면에는 “정규화된 사진이 Cloudflare R2와 Workers AI에서 처리될 수 있음”을 명확히 알린다.

“원본 파일은 전송하지 않는다”는 로컬 원본에 한해서만 사용한다. “사진이나 이미지가 외부로 전송되지 않는다”는 표현은 금지한다.

## 4. PII 경고 정책

PII 탐지는 완전 차단 수단이 아닌 개인 사용자를 돕는 경고 장치다.

검사 시점:

1. Vision 병합 결과를 Writer에 전달하기 전
2. Quality 결과를 최종 후보로 제공하기 전
3. 사용자가 편집한 Markdown을 최종 저장하기 직전

최소 탐지 범위:

- 실명으로 추정되는 표현
- 전화번호, 이메일, 주소
- 학교·학원명과 차량번호
- 주민등록번호, 여권번호, 운전면허번호
- 카드번호, 계좌번호와 그 밖의 직접 식별번호
- 사용자가 등록한 금지어

탐지 시 작업을 `waiting(pii_review)`로 멈추고 탐지 원문이 아닌 범주와 안전한 설명만 표시한다.

### 계속

- 입력 단계에서는 서버가 파생 텍스트의 탐지값을 제거하고 전체 범주를 재검사한다.
- 재검사를 통과한 정제본만 Writer·Quality에 전달한다.
- 출력 단계에서는 경고와 최종 후보를 소유자에게 보여주고 편집 기회를 제공한다.
- PII가 남은 후보를 저장하려면 별도의 명시적 acknowledgement가 필요하다.
- 편집 또는 위험 확인 뒤 저장 직전 재검사와 새 candidate hash 발급을 완료해야 `waiting(final_review)`로 이동한다.
- “계속” 선택은 PII 검사 우회나 최종 저장 동의로 취급하지 않는다.

### 취소

- 후속 AI 호출을 중단한다.
- `cleanup_pending=true`로 결과 접근을 제한한다.
- 정규화 이미지, Vision·Writer·Quality 결과와 후보를 삭제한다.
- 잔존 여부 확인 후 `failed(USER_CANCELLED_PII)`로 종료한다.

탐지 원문과 위치 문자열은 D1, R2 metadata, Workflow payload 또는 로그에 저장하지 않는다. 범주·reason code와 사용자 결정은 계속·취소·완료 시 지우고 늦어도 Job 절대 만료 안에 삭제한다.

## 5. 최종 저장 확인

- PII 결정과 최종 저장 확인은 서로 다른 사용자 행위다.
- 최종 화면은 저장될 title, body, tags와 candidate hash에 대응한다.
- 저장 API는 `acknowledged=true`, candidate hash와 payload hash 일치를 검증한다.
- 사용자가 후보를 수정하면 PII를 다시 검사하고 새 candidate hash를 발급한다.
- 최종 저장 전에는 소유자 보관함에서 글을 조회할 수 없다.

최종화 순서:

1. 최종 Markdown을 R2 pending key에 기록
2. D1에 본문 없는 pending 메타데이터 기록
3. 정규화 이미지와 임시 산출물 삭제
4. R2 `jobs/.../images`, `jobs/.../temp`와 D1 임시 참조의 잔존 여부 검증
5. D1 트랜잭션으로 Job completed와 최종 메타데이터 visible 전환

삭제 검증 실패 시 completed/visible로 바꾸지 않고 cleanup을 재시도한다.

## 6. 저장 위치와 보관

| 데이터 | 저장 위치 | 최대 보관 또는 삭제 기준 |
|---|---|---|
| 정규화 이미지 | R2 `users/{ownerId}/jobs/{jobId}/images/` | 업로드 후 최대 24시간 |
| Vision·Writer·Quality·후보 | R2 `users/{ownerId}/jobs/{jobId}/temp/` | 생성 후 최대 24시간 |
| Job 상태·PII 범주 | D1 | PII 임시값은 계속·취소·완료 시 삭제, 늦어도 Job 절대 만료 전 |
| 최종 Markdown | R2 `users/{ownerId}/posts/{postId}.md` | 사용자 삭제까지 |
| 제목·요약·R2 key 등 최종 메타데이터 | D1 | 사용자 삭제까지 |
| 설정·사용량 집계 | D1 | 사용자가 초기화하거나 별도 정책으로 삭제할 때까지 |

- Job 절대 만료는 생성 시각부터 설정값 이내이며 어떤 상태에서도 24시간을 넘지 않는다.
- 완료·취소 시 임시 데이터 삭제를 즉시 시작한다.
- `waiting`, `processing`, `reupload_required`인 모든 비종료 Job은 만료 시 `failed(SOURCE_EXPIRED)`로 전환하고 임시 데이터와 PII 임시 필드를 삭제한다.
- 24시간은 정리 지연을 포함한 절대 상한이다.
- Workflow deadline, 최소 시간 단위 scheduled cleanup과 R2 Lifecycle을 함께 사용한다.
- R2 Lifecycle은 애플리케이션 정리 실패에 대비한 안전망이지 정확한 삭제 시각의 유일한 수단이 아니다.
- 최종 글 삭제는 R2 Markdown과 D1 메타데이터를 함께 삭제하고 잔존 여부를 확인한다.
- 삭제 결과에는 Job ID, 대상 종류, 개수, 요청·완료 시각과 오류 코드만 기록한다.

## 7. 로그와 외부 처리

- 사진, 사용자 파일명, 프롬프트, Vision 결과, 초안, 최종 본문과 PII 원문을 일반 로그에 기록하지 않는다.
- Workflow 단계에는 artifact ID, hash와 비민감 상태만 기록한다.
- AI Gateway를 사용하는 경우 payload logging을 비활성화한다.
- 정규화 이미지는 Cloudflare Workers AI Vision에서 처리된다.
- PII 재검사는 애플리케이션 내부 규칙으로 수행하며 탐지 원문을 다른 AI 제공자에게 추가 전송하지 않는다.
- Claude 등 별도 AI 제공자는 현재 MVP에서 비활성화한다.

## 8. UI 진실성

- `100% 차단`, `완전 보호`, `1초 삭제`, `영구 소각`, `Zero-Retention 보장` 문구를 사용하지 않는다.
- 삭제는 “완료·취소 시 즉시 삭제를 시작하며 최대 24시간 안에 정리”로 설명한다.
- 임시 사진과 최종 Markdown의 서로 다른 보관 기간을 구분한다.
- secret, 내부 bucket/database 이름과 불필요한 기술 용어를 일반 화면에 노출하지 않는다.
- 보안 기능은 구현과 통합 테스트 증빙이 있을 때만 활성 상태로 표시한다.

## 9. 필수 보안 테스트

1. Firebase token 누락·위변조·만료 401
2. 유효한 비소유자 token 403
3. Worker 직접 호출과 공개·fallback·접두사 token 거부
4. 다른 owner의 Job·R2 key·최종 글 접근 거부
5. 2048px/WebP q0.82 정규화와 파일명·EXIF/GPS 제거 확인
6. 비정상 WebP, metadata 포함 payload, 10MiB 초과와 치수 초과 거부
7. 입력 PII 계속 시 전체 치환·재검사와 취소 시 후속 AI 중단
8. 출력 PII 경고, 편집, acknowledgement와 candidate hash 검증
9. pending → 임시 삭제 → 잔존 검증 → completed 순서
10. 완료·취소·실패·24시간 만료와 cleanup 재시도
11. 최종 글 삭제 후 R2와 D1 잔존 없음
12. 설정 allowlist와 인증·PII 우회 옵션 거부
13. BFF, Worker, Workflow와 AI Gateway 로그의 payload 부재

외부 공개 전에는 동의·철회, 계정 삭제, 다중 사용자 격리, 아동·대리인 동의, 개인정보처리방침과 처리자·국외 이전 고지를 별도로 설계하고 승인한다.
