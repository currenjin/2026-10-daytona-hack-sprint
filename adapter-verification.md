# /prepare · 부분완료 | 2026-daytona-hacksprint-seoul-oct18

2026-10-13 복구 결과. 실제 remote provider/Daytona는 호출하지 않았다. 전체 행사 준비 또는 sponsor PASS가 아니다.

## 복구와 검증

중단된 lib/adapters.mjs는 test-first stub이었고 adapter-verification.md는 없었다. 기존 local runner/server를 유지하면서 OpenAI-compatible JSON 패치 생성, 고정 소스 allowlist, readiness/opt-in, bounded response/timeout, 안전한 오류, Daytona fresh sandbox 3단계 실행과 삭제 후 exact-id readback을 구현했다. 모델 입력은 합성 소스, 실패 관찰, 요구사항과 고정 migration excerpt이며 런타임 문서 다운로드는 없다.

UI의 test-double 다운로드 허용 회귀를 실제 RED로 재현한 뒤 막았다. backend patch endpoint도 같은 차단을 적용했다. config에 readiness를 노출하고 준비되지 않은 remote mode는 실행 버튼을 비활성화한다. 선택한 provider/environment 표시가 기존 local 정적 문구를 대체한다.

최종 전체 테스트 81/81 통과, fail/skip 0. 실제 Node local 실행은 10/10 → 6/10 → 10/10. Daytona 전송 대역은 TEST_DOUBLE_VERIFIED, sponsorUsed:false이며 provider 성공이 아니다. remote worker bundle 자체도 로컬 Node에서 실제 3단계를 실행했으며 이 결과를 Daytona 실행으로 부르지 않는다.

installed @daytona/sdk 0.224.0의 create/get/delete, uploadFile, executeCommand 계약을 확인했고 scripts/sdk-contract.ts를 기존 tsc로 --noEmit 검사해 exit 0을 확인했다. 제품 TypeScript compile 검증은 별개로 미지원이다.

실제 isolated Chrome에서 시작, 중복 클릭 단일 실행, 결과, 10개 입력 표시, patch/evidence 다운로드 내용 일치, reset 후 새 ID, 390px overflow 없음과 pageerror 없음 확인. remote readiness UI 검증은 config 응답 대역만 사용했다. browser_exec의 loopback 접근 제한은 로컬 Playwright/Chrome으로 우회했다.

contracts/demo-oracle-v1.json, demo-contract-v1.json 및 fixture는 복구 전과 과거 before-adapters 백업에 byte-identical. 임시 서버는 종료했고 port closed readback을 확인했다.

## 증거

/Users/oc_currenjin/.hermes/cache/scratch/thread-recovery-20261013/daytona/

red-tests.log, full-tests.log, sdk-typecheck.log, local-verification.json, remote-bundle-local-runtime.json, browser-run.json, browser-qa.json, browser-downloaded.patch, browser-downloaded-evidence.json, browser-result.png, browser-mobile.png, immutable-identity.json, server-stop-verification.json. 복구 전 산출물은 before/에 보존.

## 남은 것

실제 모델과 Daytona 연결/품질/계정/quota/비용은 미검증. 별도 외부 전송·호출·비용 승인을 받아야 한다. create 응답 실패로 ID를 확보하지 못하면 자원 부재를 확인할 수 없음을 기록하고 요청 TTL 10분을 보조 수단으로 남긴다. 일반 PR/임의 코드, Nosana와 실제 행사 sponsor 요건은 미확정.

제품은 Git 저장소가 아니므로 branch/HEAD/commit 복구 기준점은 없다. /adapt 전 전체 준비 상태 보존 방법을 확인해야 한다. commit/push/deploy/설정 변경/Discord 전송은 하지 않았다.
