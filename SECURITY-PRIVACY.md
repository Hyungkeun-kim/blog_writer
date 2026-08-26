# SECURITY_PRIVACY v2.1

## 인증 필수
- 모든 테이블 user_id = auth.users(id) 참조, RLS 활성화
- 사용자는 자기 데이터만 조회·생성, 상태 변경은 백엔드 RPC만
- 서비스 키 브라우저 전달 금지
- JWT에서만 user_id 추출, body 값 신뢰 금지

## RLS 정책

```sql
-- generation_jobs
alter table generation_jobs enable row level security;
create policy jobs_select on generation_jobs for select using (auth.uid() = user_id);
create policy jobs_insert on generation_jobs for insert with check (auth.uid() = user_id);
-- update는 RPC만, 직접 update 금지

-- upload_slots
create policy slots_select on upload_slots for select using (auth.uid() = user_id);

-- pii_review_queue - 격리 테이블, 원문 저장 금지
create policy pii_select on pii_review_queue for select using (auth.uid() = user_id);
```

## R2 보안

- private 버킷, 경로 users/{userId}/jobs/{jobId}/slot_{id}.jpg (서버 생성, prefix 분해 검증)
- Presigned PUT: @aws-sdk/s3-request-presigner, IfNoneMatch: "*" 포함, 600초 만료, 재사용 시 412
- 검증: 객체 존재, 경로, 크기 10MiB, Content-Type JPEG/PNG/WebP, 이미지 디코딩 성공, 체크섬, 만료 여부
- 실패 시 즉시 삭제

## PII 처리

- MVP 실명 수집 안함, payload 전달 안함, 결과 아이1, 아이2
- Vision 프롬프트: 관찰 가능한 행동만, 감정/성격/건강/가족 추론 금지
- 검사 2회: Claude 전, 저장 전
- 탐지 시 즉시 needs_review 종료, 원문·이름·결과 일반 테이블·로그 저장 금지, 격리 테이블에는 유형·위치·사유 코드만
- childNames Workflow payload/log에 넣지 않음

## 보관기간 확정

- 원본 이미지: 최대 24시간
- 중간 Vision·Writer 결과: 완료 또는 실패 즉시 삭제
- PII 사유 메타데이터: 7일
- 최종 게시글: 사용자 삭제할 때까지
- 삭제 작업: 최소 매시간 실행, 최대 보관 24시간 + 1시간 = 25시간

## AI 데이터 정책

- "AI 비보존" 단정 금지
- Cloudflare는 훈련 미사용이지만 처리 과정 보존과 다름
- Gateway 기본 로그 저장 → cf-aig-collect-log-payload: false로 payload 차단, 메타데이터만 유지
- 참고: https://developers.cloudflare.com/workers-ai/platform/data-policy/ , https://developers.cloudflare.com/ai-gateway/logging/

## 동의·철회·삭제

- 동의: 사진 및 파생 텍스트 외부 전송 고지, 체크박스 기본 해제, consent_version, 시각, 목적, provider, IP 목적·보존기간 명시 또는 제외
- 철회: 동의 철회 시 진행 중 Job 중단, 원본·중간 결과 즉시 삭제, PII 메타 7일 후 삭제
- 계정 삭제: 모든 posts, memories, upload_slots, R2 객체, 벡터, 로그 삭제, PII 메타 7일 후 삭제
- 원본 vs 파생 텍스트 provider·보존 범위 구분 표 제공

## Service Role

- RLS 완전 우회, 별도 관리자 클라이언트, 명시적 user_id 조건, 감사 로그 필수
- 스토리지 메타데이터 예외도 사용자 데이터 접근이므로 감사 로그 필요
