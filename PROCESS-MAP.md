# blog_writer 프로젝트 프로세스 맵 (Process Map)

본 문서는 개인용 비공개 MVP의 **목표 프로세스**를 시각화합니다. 현재 소스는 스캐폴드 단계이며 이 흐름이 구현 완료되었음을 의미하지 않습니다.

---

## 1. 전체 비즈니스 수명주기 프로세스 (End-to-End Lifecycle)

사용자가 사진을 등록하고 블로그 글 초안을 생성한 뒤, 최종 확인과 임시 데이터 삭제 검증을 거쳐 완료되는 목표 흐름입니다.

```mermaid
sequenceDiagram
    autonumber
    actor User as 사용자 (브라우저)
    participant Server as Worker API 서버
    participant DB as Supabase Postgres
    participant R2 as Cloudflare R2 (Private)
    participant WF as Cloudflare Workflows
    participant AI as Workers AI (Vision & Gemma)

    Note over User, DB: 1단계: 작업 생성
    User->>Server: POST /api/jobs (슬롯 수, 멱등키)
    Server->>DB: Job & Upload Slots 레코드 생성 (상태: waiting / upload)
    Server-->>User: jobId, 슬롯 목록 반환

    Note over User, R2: 2단계: 사진 업로드 및 서버 검증
    loop 각 사진 슬롯
        User->>Server: PUT /api/jobs/{id}/photos/{slot} (바이트 전송, 파일명 제외)
        Server->>Server: 형식 검사·디코딩 후 방향 보정·재인코딩
        Server->>Server: EXIF/GPS 제거 및 정규화 바이트 체크섬 계산
        alt 검증 실패
            Server->>DB: 슬롯 실패 기록 & 상태: reupload_required
            Server-->>User: 재업로드 요청
        else 검증 성공
            Server->>R2: Private R2 저장 (users/{uid}/jobs/{id}/slot_{slot})
            Server->>DB: 슬롯 업로드 완료 기록
            Server-->>User: 슬롯 업로드 성공
        end
    end

    Note over User, AI: 3단계: 파이프라인 처리 (Processing)
    User->>Server: POST /api/jobs/{id}/start
    Server->>DB: 상태 전이 (waiting -> processing)
    Server->>WF: BlogWriterWorkflow 트리거
    
    rect rgb(240, 245, 255)
        Note over WF, AI: Workflow 단계별 실행
        WF->>DB: 1. 슬롯 전체 검증 확인
        WF->>AI: 2. 정규화 사진 Vision 분석 (사진 바이트 전송)
        WF->>Server: 3. Vision 결과 직접 식별정보 검사
        alt 입력 식별정보 발견
            WF->>DB: 결과 접근 차단 & cleanup_pending
            WF->>R2: R2 사진 삭제
            WF->>DB: 중간 데이터 삭제 후 failed
        else 입력 검사 통과
            WF->>AI: 4. 초안 작성 및 품질 검수
            WF->>Server: 5. 최종 후보 직접 식별정보 검사
            alt 출력 식별정보 발견
                WF->>DB: 결과 접근 차단 및 임시 데이터 정리
            else 출력 검사 통과
                WF->>DB: 서버 전용 임시 초안 저장 & waiting(user_review)
            end
        end
    end

    Note over User, DB: 4단계: 결과 조회 및 사용자 종료
    User->>Server: GET /api/jobs/{id}/result
    Server-->>User: 생성된 블로그 초안 반환
    
    User->>Server: POST /api/jobs/{id}/finish (사용자 명시적 종료)
    Server->>DB: 최종 블로그 포스트를 pending으로 저장
    Server->>R2: R2 원본 이미지 삭제
    Server->>DB: temp_artifacts 삭제 및 잔존 여부 검증
    Server->>DB: 상태 completed & 최종 글 공개
    Server-->>User: 작업 완료 응답
```

---

## 2. 서버 전용 상태 머신 전이도 (State Transition Map)

시스템의 상태는 오직 서버에서만 전이되며, `waiting`, `processing`, `reupload_required`, `completed`, `failed` 5개로 엄격히 제한됩니다.

```mermaid
stateDiagram-v2
    [*] --> waiting_upload: POST /api/jobs (작업 생성)
    
    state "waiting (reason: upload)" as waiting_upload
    state "reupload_required" as reupload
    state "processing" as processing
    state "waiting (reason: user_review)" as waiting_review
    state "completed" as completed
    state "failed" as failed

    waiting_upload --> processing: 모든 슬롯 업로드 검증 완료 & start 호출
    waiting_upload --> reupload: 슬롯 손상, 만료 또는 검증 실패
    reupload --> waiting_upload: POST /api/jobs/{id}/reupload
    
    processing --> waiting_review: AI 초안 생성 완료 & PII 검사 통과
    processing --> reupload: 처리 중 이미지 디코딩 실패
    
    waiting_review --> completed: finish + 원본/중간 데이터 삭제 검증 완료
    
    waiting_upload --> failed: 업로드 취소 / 24시간 타임아웃
    processing --> failed: 직접 식별정보 발견 / AI 오류 / 치명적 장애
    waiting_review --> failed: 사용자 작업 취소 (/cancel)
    reupload --> failed: 취소 / 타임아웃

    completed --> [*]: 종료 상태
    failed --> [*]: 본문 비노출, cleanup_pending이면 삭제 재시도
```

---

## 3. 보안 및 PII(개인정보) 실시간 방어 프로세스

```mermaid
flowchart TD
    Start[Vision 결과 또는 최종 후보 수신] --> Detect[서버 내부 직접 식별정보 검사]
    Detect --> HasPII{PII 패턴 발견?}

    HasPII -- 아니오 (안전) --> Store[temp_artifacts 서버 전용 임시 저장]
    Store --> Ready[waiting: user_review 상태로 전환]

    HasPII -- 예 (위험) --> Block[후속 호출과 본문 접근 차단]
    Block --> Pending[cleanup_pending 설정]
    Pending --> DeleteR2[R2 원본 사진 삭제]
    Pending --> DeleteTemp[temp_artifacts 중간 데이터 삭제]
    DeleteR2 --> FailJob[잔존 검증 후 failed]
    DeleteTemp --> FailJob
    FailJob --> NotifyUser[사용자에게 고정 경고 표시]
```

---

## 4. 유지관리 하네스 및 서브에이전트 협업 흐름 (Harness Workflow)

> **[필수 개발 원칙]** 시스템의 모든 기능 구현, 아키텍처 변경, 보안 감사, QA 배포 심사는 **항상 하네스 구조의 전문 서브에이전트를 호출**하여 진행합니다. 오케스트레이터는 독립적인 각 역할(`System Architect`, `Security Auditor`, `Workflow Implementer`, `Technical QA`)을 `invoke_subagent`로 호출하여 병렬/순차 심사를 수행하고, 모든 서브에이전트의 승인(`APPROVED`)을 획득한 후 릴리스 게이트를 통과시킵니다.


```mermaid
flowchart LR
    subgraph Step1[1. 기획 및 계획]
        O[Orchestrator] -->|Manifest 생성| M[manifest.json]
    end

    subgraph Step2[2. 컨텍스트 분배]
        M -->|prepare:agents| P[Role별 context-*.json]
    end

    subgraph Step3[3. 전문 서브에이전트 독립 심사]
        P --> A[blog_writer_architect<br/>- CR-1 상태머신/DB/멱등성]
        P --> S[blog_writer_security<br/>- CR-2 PII/삭제/보안]
        P --> I[blog_writer_implementer<br/>- Workers/Workflows 구현]
    end

    subgraph Step4[4. QA 및 릴리스 게이트]
        A -->|PASS 보고서| QA[blog_writer_qa]
        S -->|PASS 보고서| QA
        I -->|구현 완료 보고서| QA
        QA -->|pnpm run release:gate| Release{릴리스 승인}
    end

    Release -- 통과 --> Deploy[배포 진행]
    Release -- 차단 --> Fix[수정 후 새 후보 해시로 재심사]
```

---

## 5. 핵심 정책 요약 매트릭스

| 구분 | 주요 제약 및 정책 | 검증 하네스 |
|---|---|---|
| **상태 제어** | 클라이언트 직접 변경 금지, 5대 상태 엄격 유지 | `check:state`, `tests/state-machine.test.mjs` |
| **개인정보 보호** | 사진은 Workers AI에서 처리, 직접 식별정보 발견 시 후속 호출·본문 노출 차단 | 규칙 단위 테스트, 구현 후 통합 테스트 필요 |
| **데이터 보관** | 원본·중간 산출물 최대 24시간, 사용자 종료 시 조기 삭제 | `SECURITY-PRIVACY.md` 목표 기준 |
| **AI 모델 운영** | Vision: Llama 3.2 11B, Draft: Gemma 4 26B (일일 무료 범위 최적화) | Cloudflare Workers AI 바인딩 |
| **품질 및 배포** | 개인용은 `verify`, 공개 전에는 강화된 역할·해시 게이트 적용 | `verify`, 향후 강화할 `release:gate` |
