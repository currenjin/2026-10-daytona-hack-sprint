# 패키지 업그레이드 실험실 — 로컬 MVP

의존성 버전 전환 전후에 같은 동작 기준을 실행하고, 수정 패치와 실제 실행 증거를 제공합니다.

> Daytona HackSprint Seoul · 2026-10-18 · 행사 전 준비 중

비공개 준비 저장소: `currenjin/daytona-hack-sprint-2026-10-18`. 기존 2026-09-19 Collider 출품작과 별도 제품입니다.

- [준비 상태와 현장 연결 계획](docs/PREPARATION.md)
- [실제 로컬 결과 화면](docs/screenshots/result.png) · [모바일 화면](docs/screenshots/mobile.png)
- 발표 슬라이드·대본·제출 문구는 아직 작성하지 않았습니다. 실제 모델/Daytona 결과는 현장 검증 후 반영합니다.

## 현재 지원

- 합성 Zod settings fixture 한 개, 정확히 3.25.76 → 4.1.12.
- 고정 oracle 인증 → 기존/변경/수정 상태를 별도 Node 프로세스에서 실행.
- 공식 변경 안내에 근거한 로컬 규칙 기반 자동 source patch.
- 승인된 검정·라임 UI, 실제 진행 단계, 입력별 결과, 패치/증거 다운로드, 새 검증.

기본 provider는 local-rule이고 환경은 local입니다. OpenAI-compatible 패치 생성과 Daytona 0.224.0 실행 adapter를 구현했으며 외부 opt-in/설정 readiness, 고정 소스 allowlist, 오류 비밀값 차단, sandbox 삭제 readback 경계를 로컬 테스트로 확인했습니다. 실제 모델·Daytona는 호출하지 않았습니다. test-double 결과는 TEST_DOUBLE_VERIFIED이며 genuine provider 또는 sponsor PASS가 아닙니다. 실제 GitHub PR, 범용 업그레이드, Nosana, TypeScript 제품 컴파일은 미지원/미검증입니다. LOCAL_VERIFIED는 고정 로컬 계약만 검증하며 행사 제품 전체 PASS가 아닙니다.

## 실행

검증한 환경: Node v25.8.1, npm 11.11.0. 다른 Node 버전 호환성은 별도 확인해야 합니다.

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm test
node --test ui-test/state.test.mjs
npm run verify
npm start
```

브라우저에서 http://127.0.0.1:4318 을 엽니다. PORT 환경 변수로 loopback 포트를 변경할 수 있습니다. 외부 네트워크 공개는 지원하지 않습니다.

새 검증 버튼은 새 실행을 시작할 입력 화면으로 돌아갑니다. 서버 종료/재시작 시 in-memory 실행 이력은 사라집니다. 필요한 패치와 증거를 먼저 내려받으세요. npm run verify는 .runs/verify-evidence.json에 실제 결과를 원자적으로 저장합니다. 서버 프로세스는 Ctrl+C로 종료합니다. 추적된 Hermes 프로세스는 parent의 process handle로 중단할 수 있습니다.

## 평가 기준과 보안 경계

contracts/demo-oracle-v1.json은 승인된 외부 계약의 복사본이고 canonical SHA-256으로 인증합니다. fixtures/zod-settings/schema.mjs만 알려진 record → partialRecord 규칙으로 바꿀 수 있습니다. tests/evaluator/oracle 변경이나 downgrade/validation bypass는 거절합니다.

이 로컬 runner는 임의 repo·명령·모델 코드를 받지 않으며 OS sandbox가 아닙니다. 프로세스 분리를 미신뢰 코드의 보안 격리로 주장하지 않습니다. 실제 repo 및 AI 생성 소스는 Daytona 같은 격리 실행 경계를 구현한 뒤에 지원해야 합니다.

## 검증 결과

현재 정확한 테스트 수와 부모가 실제 재실행한 범위는 adapter-parent-verification.md 및 kit의 evidence/adapters-verification-receipt.json에 있습니다. Backend 70/70, UI 11/11이며 합계 81개가 통과했습니다. 실제 Chrome에서 10/10 → 6/10 → 10/10, 중복 시작 방지, patch/evidence 다운로드, 초기화 후 새 실행과 390px 가로 overflow 없음, pageerror 없음 확인. 준비되지 않은 외부 설정은 실제 loopback 서버로 CONFIG_ERROR, 시작 버튼 비활성과 runner 호출 0을 확인했습니다.

TDD RED/GREEN 내역은 backend-verification.md 참조. 기존 수동 spike와 이번 자동 로컬 rule 실행은 서로 다른 증거입니다. 테스트 통과가 실제 모델 품질이나 sponsor 연결 성공을 뜻하지 않습니다.

## 근거와 라이선스

- 공식 migration guide: https://zod.dev/v4/changelog#improves-enum-support
- Zod: https://github.com/colinhacks/zod (MIT), 정확한 버전은 package-lock.json에 고정.
- 원본 요구사항/디자인 승인/행사 계약은 hackathon-kit의 workspace/2026-daytona-hacksprint-seoul-oct18/에 유지.
- 사용자 이미지 레퍼런스의 원본 파일은 이 제품에 포함하지 않았습니다.

사전 제작이 공식 허용되었다고 확인하지 않았습니다. 사용자 승인 아래 허용 가정으로 만든 로컬 준비물입니다. 현재 소스는 비공개 준비 저장소에서 보존합니다. 공개 배포 및 실제 외부 모델·sponsor 호출은 하지 않았습니다. Daytona 키·크레딧은 행사장에서 받아 `/adapt` 단계에서 연결하는 계획입니다.
