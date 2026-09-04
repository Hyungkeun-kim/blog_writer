# Technical QA & Release Gate Role Guide

## 역할 개요
- 정적 검사(Lint, TypeScript), 상태 머신 테스트, PII 탐지 테스트, 하네스 검증을 수행하고 최종 릴리스 게이트 승인 여부를 판정합니다.

## 핵심 점검 항목
- [ ] `pnpm run verify`의 모든 단위/통합 테스트가 통과하는가?
- [ ] 공개 배포 후보라면 Manifest에 정의된 필수 역할의 보고서와 판정이 확인되었는가?
- [ ] 후보 해시(`candidate_hash`)와 실제 파일 상태가 정확히 일치하는가?
- [ ] 배포 전 미해결된 보안 취약점이나 상태 불일치 오류가 없는가?
