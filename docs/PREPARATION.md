# 행사 전 준비 상태

행사: Daytona HackSprint Seoul, 2026-10-18 (Asia/Seoul). 제품: 패키지 업그레이드 실험실 (가칭).

## 현재 확인한 범위

- 합성 설정 스키마 fixture 하나, Zod 3.25.76 → 4.1.12.
- 고정 계약의 10개 입력을 기존/업그레이드/패치 상태에서 실제 Node 프로세스로 실행.
- 로컬 규칙 기반 patch와 동일 기준 재검증. LOCAL_VERIFIED는 실제 AI 생성이나 sponsor 실행이 아니다.
- Backend 152개 + UI 11개, 총 163개 테스트 통과. 실제 Chrome에서 시작/다운로드/reset 후 두 번 연속 10/10 → 6/10 → 10/10 확인.
- 승인된 검정·라임 UI를 구현. docs/screenshots는 실제 local 실행 화면이다.
- OpenAI-compatible patch generation 및 Daytona SDK 0.224.0 adapter 구현과 credential-free 계약 검증 완료. transport double과 진짜 provider 성공을 구분.
- 실제 모델 요청, Daytona sandbox 생성, Nosana 호출, 공개 배포는 하지 않았다.

## 재현

프로젝트 루트에서 README의 npm ci/test/verify/start 명령을 실행한다. 기본은 local-rule/local이며 외부 호출은 꺼져 있다. .env.example은 빈 예시 설정이지 credential이 아니다.

- 화면 초기화: 새 검증 버튼. 다음 실행은 새 run을 만든다.
- 서버 재시작: 실행 프로세스 종료 후 npm start. in-memory run history는 사라지므로 필요한 artifact를 먼저 다운로드한다.
- 원래 검증 기준: contracts/demo-oracle-v1.json. 성공에 맞춰 expected/tests/evaluator를 수정하지 않는다.
- Git 복구: 검증된 commit SHA와 working tree 상태를 확인하고, 변경한 소스를 보존한 뒤 별도 clone/worktree에서 해당 commit을 재현한다. 현재 작업을 자동 reset하지 않는다.

## 행사 당일 연결

사용자 계획대로 Daytona 키·크레딧은 행사장에서 받고 /adapt 단계에서 주입한다. key 미보유는 행사 전 로컬 준비의 진입 조건이 아니다.

1. /adapt 전에 branch/HEAD/working tree 및 준비 기준 이후 변경을 확인·보존.
2. 지급된 계정/키/endpoint/region/quota 및 선정한 모델 설정 확인. raw secret을 저장소·UI·로그에 남기지 않음.
3. 승인된 비용/리소스/수명 범위 안에서 명시적 외부 호출 opt-in 후 작은 실제 smoke test.
4. 같은 고정 기준으로 genuine model patch와 실제 Daytona 실행을 검증. 생성/실행/정리 실패를 별도 기록.
5. /demo on-site에서 실제 evidence를 확인한 뒤 발표·제출 자료에 결과 반영.

## 미검증과 위험

- 실제 모델 품질 및 반환 형식. 일반 formatting 차이는 보강했지만 정해진 호출 구조 밖의 표현은 여전히 보수적으로 거절한다. 상세 검증: docs/PATCH_FORMATTING.md.
- 실서비스 인증, network/registry 접근, credit/quota, 실제 cleanup readback.
- 일반 GitHub PR 입력, 임의 package/repository migration, 제품 TypeScript compile, 범용 안전성은 지원/검증하지 않는다.
- 스폰서 전체 통합은 필수로 기록했지만 개별 Daytona/Nosana 모두 필수인지 및 Nosana 채택은 미확정.
- 사전 제작 규칙, 공식 submission form/deadline 및 공개 링크 요구는 미확인. 빌드 종료 시각을 제출 마감으로 간주하지 않는다.
- 발표 슬라이드/대본/guide의 행사 전 초안은 hackathon-kit에 보존한다. 제출 문구는 아직 미작성이다. local 결과를 실제 AI/sponsor 사용으로 확대하지 않는다.

## 원본 준비 기록

공식 행사 출처, 디자인 승인과 상세 preflight/evidence는 별도 hackathon-kit 저장소의 workspace/2026-daytona-hacksprint-seoul-oct18/에 유지한다. 이 제품 저장소에는 실행에 필요한 소스/fixture/고정 contracts와 자체 검증 문서만 둔다. test 실행 데이터와 실제 secret env는 추적하지 않는다.
