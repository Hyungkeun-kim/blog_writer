# blog_writer 유지관리 및 하네스 운영 가이드

이 디렉토리는 `blog_writer` 프로젝트의 주요 변경 검토와 향후 공개 배포 게이트를 관리하는 하네스입니다. 현재는 개인용 비공개 MVP이므로 문구·오탈자 같은 문서 전용 변경에는 영향 역할만 적용하고 `pnpm run verify`를 기본 게이트로 사용합니다.

---

## 1. 하네스 작동 원칙

1. **상태 무결성**: 모든 변경은 `PRD.md`와 `TECH-DESIGN.md`에 정의된 5대 상태(`waiting`, `processing`, `reupload_required`, `completed`, `failed`) 모델과 서버 전용 데이터 전이 규칙을 준수해야 합니다.
2. **보안 및 PII 감사**: 상태, 저장, AI 처리 경계 또는 삭제 로직을 바꿀 때 Security & PII Auditor의 독립 검수를 수행합니다.
3. **독립 역할 분담**:
   - `orchestrator`: 변경 범위 정의 및 진행 조율
   - `system-architect`: 아키텍처 및 상태 머신, DB 스키마 검증
   - `security-pii-auditor`: 직접 식별정보, Cloudflare 처리 경계, 비밀키 노출과 임시 데이터 삭제 검증
   - `workflow-ai-implementer`: Workers / Workflows / AI / R2 코드 구현
   - `technical-qa`: 테스트 실행 및 최종 배포 게이트 심사

---

## 2. 주요 런타임·공개 배포 변경 절차 (Change Cycle)

1. **작업 생성**:
   - `maintenance/changes/<YYYYMMDD-작업명>/` 디렉토리를 생성합니다.
   - `templates/manifest.template.json`을 복사하여 `manifest.json`을 작성합니다.
2. **컨텍스트 패킷 생성**:
   ```bash
   pnpm run prepare:agents -- maintenance/changes/<YYYYMMDD-작업명>/manifest.json
   ```
3. **역할별 검수 및 보고서 작성**:
   - 각 역할 에이전트가 `context-<role>.json`을 기반으로 검토 후 `report-<role>.md`를 작성하고 `manifest.json`의 `verdicts`를 갱신합니다.
4. **검증 및 릴리스 게이트 통과**:
   ```bash
   pnpm run release:gate -- maintenance/changes/<YYYYMMDD-작업명>/manifest.json
   ```

현재 `release:gate`는 실제 후보 해시 재계산과 보고서 내용 검증을 완전히 강제하지 않으므로 외부 공개 전 보강해야 합니다.
