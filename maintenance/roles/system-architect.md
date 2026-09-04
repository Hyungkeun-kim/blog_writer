# System Architect Role Guide

## 역할 개요
- CR-1 서버 전용 데이터 제어 및 상태 머신(5대 상태), DB 스키마, API 인터페이스 및 멱등성 설계를 검증합니다.

## 핵심 점검 항목
- [ ] 5대 상태(`waiting`, `processing`, `reupload_required`, `completed`, `failed`) 외 불필요한 상태가 추가되지 않았는가?
- [ ] 클라이언트가 상태나 DB/R2를 직접 수정할 수 있는 권한이나 API가 노출되지 않았는가?
- [ ] 작업 완료(`completed`)가 사용자의 명시적 종료 요청 승인 시에만 이루어지는가?
- [ ] 멱등성 키(`idempotency_key`)가 모든 생성/변경 작업에 올바르게 적용되었는가?
