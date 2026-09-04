# blog_writer PRD v3.0 — 개인용 비공개 MVP 목표 설계

**상태:** TARGET · 미구현 항목 포함
**사용자:** 소유자 1명
**우선순위:** 이 문서가 제품 동작의 기준이며, 보안 경계는 `SECURITY-PRIVACY.md`, 구현 계약은 `TECH-DESIGN.md`를 따른다.

이 문서는 목표 설계다. 소스, 테스트와 배포 증빙이 확인되지 않은 항목은 구현 완료로 간주하지 않는다.

## 1. 목표와 범위

- 사용자가 본인 소유 또는 사용 허락을 받은 사진 3~20장으로 블로그 초안을 만든다.
- 외부 가입, 다중 사용자 서비스, 결제, 공개 게시 기능은 제공하지 않는다.
- 문체 학습, 외부 URL 수집, pgvector/Vectorize는 현재 MVP에서 제외한다.
- 일반 얼굴·인물 사진은 허용하지만 신원 식별, 생체 인증, 얼굴 마스킹은 수행하지 않는다.
- 화면은 일반 사용자가 이해할 수 있는 한국어를 우선하고, 제품 내부 용어는 설명과 함께 제한적으로 표시한다.

## 2. 확정 아키텍처

```text
Browser
  → Firebase Authentication(Google)
  → Cloud Run BFF
  → Cloudflare Worker
      ├─ D1
      ├─ R2
      ├─ Workers AI
      └─ Workflows
```

- 브라우저는 Firebase ID token을 Cloud Run BFF에 전달한다.
- BFF는 token의 서명, issuer, audience, 만료, 이메일 인증 여부를 검증하고 `OWNER_EMAILS`의 정확한 이메일만 허용한다.
- 인증 정보가 없거나 무효하면 401, 유효하지만 소유자가 아니면 403을 반환한다.
- BFF만 서버 간 자격증명으로 Worker를 호출한다. Worker는 직접 인터넷 호출을 거부한다.
- 기본 PIN, 하드코딩 fallback token, 접두사만 검사하는 token은 금지한다.
- D1은 Job, 슬롯, 상태, 설정, 사용량, 최종 글 메타데이터를 저장한다.
- R2는 정규화 이미지, 서버 전용 임시 산출물과 최종 Markdown을 private 객체로 저장한다.
- 최종 Markdown 본문을 D1에 중복 저장하지 않는다.

## 3. 사용자 흐름

1. Google 계정으로 로그인한다.
2. 사진 3~20장을 선택한다.
3. 브라우저가 각 사진을 긴 변 최대 2048px, WebP 품질 0.82로 정규화한다.
4. BFF를 통해 정규화 사진만 업로드한다.
5. Worker가 업로드를 검증하고 Workflow를 시작한다.
6. Vision 결과에서 PII가 감지되면 작업을 멈추고 계속 또는 취소를 묻는다.
7. 계속하면 서버가 Writer에 전달할 파생 텍스트에서 탐지값을 제거하고 재검사한 뒤 작성한다.
8. Writer와 Quality 결과를 다시 PII 검사한다.
9. 최종 후보와 경고를 소유자에게 보여준다.
10. 사용자가 편집·확인하고 별도의 “최종 Markdown 저장”을 승인한다.
11. 서버가 최종 글을 pending으로 준비하고 임시 데이터를 삭제·검증한 뒤 completed로 전환한다.

PII 계속 결정은 최종 저장 동의가 아니다.

## 4. 인증과 서버 전용 제어

- `owner_id`는 Firebase 검증 결과로만 결정하며 요청 본문 값을 신뢰하지 않는다.
- 브라우저에는 Worker 서비스 token, D1/R2/Workers AI 자격증명을 제공하지 않는다.
- Job, R2 객체, 상태, 설정, 사용량과 최종 글은 BFF와 Worker만 생성·변경·삭제한다.
- 모든 조회와 변경은 `owner_id` 조건을 적용한다.
- Job 생성, PII 결정, 최종 저장과 취소는 idempotency key를 사용한다.
- 설정 변경은 허용된 키와 범위만 받고 알 수 없는 키는 거부한다.

## 5. 상태 모델

상태는 다음 다섯 개만 사용한다.

| 상태 | 의미 |
|---|---|
| `waiting` | 업로드, PII 결정 또는 최종 확인 대기 |
| `processing` | 검증, AI 처리, 삭제 또는 완료 처리 중 |
| `reupload_required` | 누락·손상·형식 오류·만료로 재업로드 필요 |
| `completed` | 최종 저장과 임시 데이터 삭제 검증 완료 |
| `failed` | 복구 불가 오류, 사용자 취소 또는 만료 |

`waiting_reason`은 `upload | pii_review | final_review`만 사용한다.

```text
create                                      → waiting(upload)
waiting(upload)                             → processing | reupload_required | failed
reupload_required                           → waiting(upload) | failed
processing + input PII detected             → waiting(pii_review)
waiting(pii_review,input) + continue         → processing
processing + output PII detected            → waiting(pii_review)
waiting(pii_review,output) + edit/confirm    → processing(recheck) → clear 또는 위험 acknowledgement → waiting(final_review)
waiting(pii_review) + cancel                → failed
processing + candidate ready                → waiting(final_review)
waiting(final_review) + final confirmation  → processing → completed
모든 비종료 상태 + expiry/cancel            → failed
```

- 일반 상태 변경 API는 `completed`를 직접 설정할 수 없다.
- 각 전이는 현재 상태와 `waiting_reason`을 함께 비교하는 compare-and-set으로 처리한다.
- 입력 PII 결정은 Vision 병합 artifact의 `observation_hash`, 출력 PII 결정은 후보의 `candidate_hash`와 연결한다.
- 최종 저장 확인은 출력 검토 뒤 발급된 `candidate_hash`와 연결한다.

## 6. 이미지 전송 경계

- 로컬 원본 파일은 사용자 기기를 벗어나지 않는다.
- 브라우저는 방향을 반영하고 긴 변을 최대 2048px로 줄여 WebP 품질 0.82로 재인코딩한다.
- 전송 payload에는 사용자 파일명, EXIF/GPS와 원본 metadata를 넣지 않는다.
- BFF/Worker는 인증·소유권, 최대 10MiB, WebP magic bytes, 실제 디코딩, 최대 치수와 metadata 부재를 검증한다.
- 부적합한 이미지는 R2에 보관하지 않고 `reupload_required`로 전환한다.
- 검증된 정규화 바이트만 R2 저장과 Workers AI Vision에 사용한다.
- “원본 파일 미전송”은 말할 수 있지만 “이미지가 외부로 전송되지 않는다”고 표현하지 않는다.

## 7. PII 경고와 사용자 결정

검사 시점:

1. Vision 병합 결과를 Writer에 전달하기 전
2. Quality 결과를 최종 후보로 표시·저장하기 전
3. 사용자가 편집한 최종 Markdown을 저장하기 직전

대상은 실명, 연락처, 이메일, 주소, 학교·학원명, 차량번호, 주민등록번호, 여권·면허·카드·계좌 등 직접 식별정보와 사용자 금지어다.

탐지 시:

- 작업을 `waiting(pii_review)`로 멈춘다.
- 탐지 원문 대신 범주와 안전한 설명만 표시한다.
- 입력 단계의 “계속”은 서버가 파생 텍스트의 모든 탐지값을 치환하고 재검사를 통과한 경우에만 허용한다.
- “취소”는 후속 AI 호출을 막고 정규화 이미지와 임시 산출물을 삭제한다.
- 출력 단계는 경고와 후보를 보여주고 사용자가 편집할 수 있게 한다.
- PII가 남은 후보를 저장하려면 위험을 확인하는 별도 acknowledgement가 필요하다.
- 출력 후보의 편집 또는 위험 확인 뒤 저장 직전 재검사를 수행하고, 새 candidate hash를 발급한 후에만 `waiting(final_review)`로 이동한다.
- 저장 직전 payload hash가 사용자가 확인한 candidate hash와 일치하는지 검증한다.

PII 탐지는 완전 차단을 보장하지 않는 보조 안전장치다. 화면에서 `100% 차단`이라고 표현하지 않는다.

탐지 원문과 위치 문자열은 D1, 로그 또는 Workflow payload에 저장하지 않는다. 범주·reason code와 사용자 결정은 해당 Job의 임시 정보이며, 계속·취소·완료 시 지우고 늦어도 Job 절대 만료 시각 안에 삭제한다.

## 8. AI 파이프라인

- Vision 기본: Llama 3.2 Vision
- Vision 대안: Llama 4 Scout
- Writer·Quality 기본: Gemma 4
- Writer·Quality 대안: GLM 4.7 Flash
- 배포 시 정확한 모델 ID를 서버 allowlist로 관리한다.
- Vision은 정규화 사진만 받고 관찰 가능한 대상·행동·장소·문자만 구조화해 반환한다.
- Writer와 Quality에는 PII 재검사를 통과한 파생 텍스트만 전달한다.
- Quality는 Writer와 별도로 실행하며 사실 일치, 문체, 금지 추론과 PII 위험을 검사한다.
- 자동 재시도는 단계별 최대 1회로 제한한다.
- Claude와 그 밖의 외부 AI 제공자는 현재 MVP에서 비활성화한다.
- Workflow 단계와 일반 로그에 사진, 프롬프트, AI 응답 원문을 기록하지 않는다.

## 9. 저장과 삭제

| 데이터 | 저장소 | 최대 보관 |
|---|---|---|
| 정규화 이미지 | R2 private `jobs/.../images` | 업로드 후 24시간 이내 |
| Vision·Writer·Quality·후보 | R2 private `jobs/.../temp` | 생성 후 24시간 이내 |
| PII 범주·결정 | D1 Job 임시 필드 | 계속·취소·완료 시 삭제, 늦어도 Job 절대 만료 전 |
| 최종 Markdown | R2 private `posts/{postId}.md` | 사용자 삭제까지 |
| 최종 글 메타데이터 | D1 | 사용자 삭제까지 |

최종화 순서:

1. 확인된 candidate hash와 요청 payload hash를 검증한다.
2. 최종 Markdown을 R2 pending key에 저장한다.
3. D1에 본문 없는 pending 메타데이터를 저장한다.
4. 정규화 이미지와 모든 임시 산출물을 삭제한다.
5. R2와 임시 메타데이터의 잔존 여부를 검증한다.
6. 같은 D1 트랜잭션에서 Job을 `completed`, 글을 소유자에게 표시 가능한 상태로 전환한다.

삭제가 확인되지 않으면 completed로 전환하지 않고 `cleanup_pending=true`를 유지해 재시도한다.

- Job 절대 만료는 생성 시각부터 설정값 이내이며 어떤 경우에도 24시간을 넘지 않는다.
- `waiting`, `processing`, `reupload_required`인 모든 비종료 Job은 절대 만료 시 `failed(SOURCE_EXPIRED)`로 전환하고 임시 데이터와 PII 임시 필드를 삭제한다.
- Workflow deadline, 최소 시간 단위 scheduled cleanup과 R2 Lifecycle 안전망을 함께 사용한다.
- 24시간은 정리 주기를 포함한 절대 상한이다.
- 최종 글 삭제는 R2 Markdown과 D1 메타데이터를 모두 삭제하고 잔존 여부를 확인한다.

## 10. 환경설정

사용자가 변경할 수 있는 항목:

- 정규화 사진 제한: 5MiB 또는 10MiB
- 임시 보관 시간: 1~24시간
- Vision 및 Writer·Quality 모델: 서버 allowlist 내 선택
- 생성 길이와 Vision 병렬 수: 서버 안전 범위 내 선택

사용자가 변경할 수 없는 항목:

- 실행 환경, Firebase 프로젝트, owner allowlist
- D1/R2/Workflow binding
- 서비스 token과 secret
- 인증 또는 PII 검사를 우회하는 옵션

Job 생성 시 적용 설정을 immutable snapshot으로 저장한다. 설정 화면은 리소스를 생성·삭제·재연결하지 않으며 secret은 원문으로 표시하지 않는다.

## 11. AI 사용량

- D1에 UTC 날짜, Job, 모델, 단계, 입력·출력 token, neurons, `actual | estimated` 구분을 기록한다.
- 사용량 화면은 UTC 00:00 기준으로 당일 값을 합산한다.
- 70%에서 주의, 90%에서 강한 경고를 표시하지만 개인용 MVP에서는 작업을 강제 차단하지 않는다.
- 취소, 삭제와 cleanup은 사용량 수준과 관계없이 항상 허용한다.
- 실제 과금과 무료 할당량은 Cloudflare Dashboard를 최종 기준으로 안내한다.

## 12. MVP 승인 기준

1. Firebase ID token 위변조·만료·비소유자 테스트에서 각각 401/403
2. 브라우저의 Worker 직접 호출과 공개·fallback token 거부
3. 3·8·20장 정규화 및 서버 WebP·치수·metadata 검증
4. 허용되지 않은 상태·waiting reason 전이 거부
5. 입력·출력 PII의 계속/취소와 저장 acknowledgement 통합 테스트
6. 계속 시 정제·재검사, 취소 시 후속 AI 중단과 임시 데이터 삭제
7. Writer와 Quality의 실제 Workers AI 호출 및 구조 검증
8. pending → purge → 잔존 검증 → completed 순서 검증
9. 완료·취소·실패·24시간 만료·최종 글 삭제 테스트
10. 설정 allowlist·범위·Job snapshot 테스트
11. UTC 일별 usage와 70%·90% 경고 테스트
12. 사진·프롬프트·AI 응답·PII 원문 로그 부재 확인

외부 공개 전에는 다중 사용자 격리, 동의·철회, 계정 삭제, 개인정보처리방침, 처리자·국외 이전 고지와 별도의 공개 서비스 승인이 필요하다.
