# 패치 형식 보강 및 검증

## 경계

정해진 export function createSchema(z)와 enum [email,push], boolean 값, partialRecord 호출 구조만 허용한다. 기존 before source는 byte-exact이며 입력 후보는 UTF-8 8,192 bytes 이하로 제한한다. 일반 JavaScript parser나 범용 migration 엔진이 아니다.

- 허용: 들여쓰기, LF/CRLF, 작은/큰따옴표, 허용된 일반 주석, return 끝 semicolon 생략, 정해진 배열/인자 위치의 trailing comma.
- 거절: return 직후 줄바꿈과 주석 속 줄바꿈(ASI), 토큰 합치기, sourceURL 등 지시 주석, escaped 문자열, enum/타입 변경, 추가 import/export/statement, 대입·computed access·임의 함수 호출.
- 실제 후보 bytes를 보존한다. 몰래 canonical source로 바꾸지 않는다.
- unified diff는 허용된 실제 source와 EOF newline 상태를 반영한다.
- 새 helper lib/patch-source.mjs도 실행 전후 immutable snapshot에 포함한다.

## 실행 증거

부모가 전체 suite를 실제 재실행했다: backend 152/152, UI 11/11, 총 163. fail/skip 0. 기존 독립 oracle, fixture, contracts, package와 UI/server source는 변경하지 않았다.

서로 다른 15개 formatting 후보를 validator, model transport double, raw diff reconstruction 및 실제 system patch로 검증했다. injected 모델 후보를 실제 로컬 Zod worker로 실행했으며 verdict는 TEST_DOUBLE_VERIFIED, sponsorUsed:false다. genuine model quality나 sponsor 실행 증거가 아니다.

TDD: 최초 child focused RED 22 failures → GREEN, parent trailing-comma RED → GREEN. 원본 로그와 structured evidence는 hackathon-kit workspace의 evidence/patch-formatting-*.log/json, trailing-comma-red.log, pre-event-final-*.log/json에 보존한다.

실제 local-rule/local 브라우저와 macOS TTS를 조합한 자동 리허설은 reset 후 두 번 실행했다. 발표자 본인의 발화와 실제 행사 네트워크·sponsor latency는 검증하지 않았다.

## 남은 것

정해진 호출 구조 밖의 같은 의미 표현도 보수적으로 거절한다. 실제 모델의 출력 형식·품질, Daytona 인증/실행/cleanup, sponsor별 필수 조건은 여전히 현장 확인 대상이다. fixed fixture에서의 통과를 일반 repo 코드 안전이나 운영 안전으로 확대하지 않는다.
