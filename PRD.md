# blog_writer PRD v2.1 - 최종 확정 (CR-1~7 반영)

**프로젝트:** blog_writer
**GitHub:** https://github.com/Hyungkeun-kim/blog_writer
**로컬:** <PROJECT_ROOT>
**상태:** 개발 착수 승인 대기

## 최종 아키텍처 (혼용 금지)
- 메타데이터: Supabase Postgres
- 벡터: Supabase pgvector 1024차원 (bge-m3)
- 원본 이미지: Cloudflare R2 (private)
- 실행 조정: Cloudflare Workflows
- 이미지 분석: Workers AI Llama 3.2 Vision @cf/meta/llama-3.2-11b-vision-instruct
- Writer·Quality Editor: Anthropic provider-native via AI Gateway
- 미사용: D1, Cloudflare Vectorize

## CR-1. DB 권한과 상태 전이 확정

모든 테이블에 user_id, RLS, 최소 권한 적용.

- generation_jobs.user_id = auth.users(id) 참조
- upload_slots, pii_review_queue, posts, memories에도 user_id 소유권
- 모든 테이블 RLS 활성화, 사용자는 자기 데이터만 조회·생성
- 상태 변경·완료는 백엔드 전용 RPC만, 서비스 키 브라우저 전달 금지
- 멱등성: unique(user_id, idempotency_key)

작업 상태 고정:
```
pending → awaiting_upload → uploaded → vision_running → pii_check_input → writer_running → quality_running → pii_check_output → completed
```

예외 전이만 허용:
```
awaiting_upload → expired
pii_check_input → needs_review
pii_check_output → needs_review
모든 비종료 상태 → failed
```
needs_review, completed, failed, expired는 종료 상태, 자동 이동 불가.

상태 전이 RPC는 from/to를 그대로 적용하지 않고 내부 허용 전이표 검증.

## CR-2. 다중 이미지 업로드 완성

Job과 3~20개 upload_slots를 하나의 RPC 트랜잭션으로 동시 생성, 개별 INSERT 금지.

슬롯 정보:
```
job_id, user_id, slot_id, object_key, status, expires_at, content_type, size_bytes, checksum, etag, uploaded_at
```

제약:
- slot_id 0~19
- object_key UNIQUE, 서버가 생성, 사용자 입력 prefix 금지
- 파일당 최대 10MiB, JPEG/PNG/WebP만
- Presigned PUT에 IfNoneMatch: "*"
- 클라이언트도 서명된 If-None-Match, Content-Type 그대로 전송

업로드 완료 검증 (백엔드 R2 확인 후 uploaded 전환):
- 객체 존재, 경로, 크기, Content-Type, 이미지 디코딩 성공, 체크섬, 만료 여부
- 모든 슬롯 검증 시에만 Job을 uploaded로 전환
- 만료 시 expired로 변경 + R2 객체 삭제

## CR-3. 개인정보 처리 흐름 확정

- MVP 아동 실명 수집 안함, Workflow payload 전달 안함, 결과는 아이1, 아이2 비식별 표현
- Vision 프롬프트는 관찰 가능한 행동만, 이름/성격/감정/건강·발달/가족관계 추론 금지
- PII 검사 2번: Vision 병합 결과를 Claude 보내기 전, Quality Editor 결과를 저장하기 전
- 탐지 시: 즉시 needs_review 종료, Writer/finalize 실행 안함, 일반 결과 테이블에 원문 저장 안함, 로그에 프롬프트·응답·이름 기록 안함, 격리 테이블에는 유형·위치·사유 코드만
- 보관기간:
  원본 이미지: 업로드 후 최대 24시간
  중간 Vision·Writer 결과: 완료 또는 실패 즉시 삭제
  PII 사유 메타데이터: 7일
  최종 게시글: 사용자 삭제할 때까지
  삭제 작업: 최소 매시간 실행

## CR-4. AI 호출 규격 확정

Anthropic provider-native 경로만 사용:
```
https://gateway.ai.cloudflare.com/v1/{account_id}/{gateway_id}/anthropic/v1/messages
```

필수 헤더:
```
cf-aig-authorization: Bearer {token}
anthropic-version: 2023-06-01
cf-aig-collect-log-payload: false
Content-Type: application/json
```

- Writer·Quality Editor 각각 독립 Claude 호출, 모델 claude-sonnet-4-5 고정, latest 별칭 사용 안함
- JSON 스키마 검증, 최대 2회 재시도, timeout, rate-limit, 실패 시 failed 전환, 원문 오류 로그 기록 안함
- Workers AI Vision 고정, 모델 동의 및 smoke test 첨부

## CR-5. Workflow 완성

평균 8장 기준 14단계:
```
init 1 + vision 8 + merge 1 + pii_check_input 1 + writer 1 + quality 1 + pii_check_output/finalize 2 = 14
```

- Vision 최대 3개 병렬, 단계 이름은 슬롯 ID 기반 결정적 생성 vision_slot_{id}
- 함수 계약 포함: validateVisionJson, detectPII, callClaude, qualityEditor, saveResult, verifyUploadedObject

## CR-6. pgvector 마이그레이션 완성

bge_m3_embedding(content) 미정의 함수 사용 안함.

순서:
1. embedding_v2 vector(1024) 추가
2. 배치 Worker가 Workers AI BGE-M3로 재임베딩
3. 100% 완료 검증
4. 1024차원 HNSW 인덱스 생성
5. 검색 RPC를 embedding_v2로 전환
6. 기존 컬럼 7일간 롤백용 유지
7. 검증 후 삭제

검색 RPC 조건: user_id = auth.uid(), approved_for_learning = true, threshold, 개수 제한, RLS 적용

## CR-7. 비용표 작성 방식 변경

$516.12/월 확정 비용 표시 안함, 검증 안된 추정치.

대표 Job 100건 실행해 실측:
- 3장, 8장, 20장 케이스
- Workers AI 토큰 및 neurons, Claude Writer 토큰, Claude Quality 토큰, Workflow 단계·CPU, R2 저장량·PUT·HEAD·GET, Supabase 사용량
- 건당 P50·P95 비용, 일 100/500/1000건 예상, 기본요금, 무료 전후, 월 총비용+20% 예비비

## 승인 기준 10개

1. TypeScript typecheck 통과 및 @ts-ignore 없음
2. 신규 설치·업그레이드·롤백 SQL 실행 성공
3. 사용자 A가 B 데이터 접근 불가 RLS 테스트
4. 허용되지 않은 상태 전이 실패 테스트
5. 3장·8장·20장 정상 처리 테스트
6. 중복 PUT 412 테스트
7. 부분 업로드·만료·고아 객체 삭제 테스트
8. 입력·출력 PII 차단 및 로그 비노출 테스트
9. Writer·Quality Editor 실제 Gateway 호출 테스트
10. 대표 Job 100건 비용 측정 결과

문서 수정만 완료되면 개발 착수 승인, 테스트 증빙까지 완료되면 배포 승인.
