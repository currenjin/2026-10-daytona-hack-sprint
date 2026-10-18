# Golden Sea

Estimate where a person lost at sea has drifted, from a single report.
A report gives only a rough place and time, so Golden Sea computes several cases at once (fell 15 min earlier, reported time, fell 15 min later, 1 km position radius) and shows how far apart the results are.

![Golden Sea: four cases computed in Daytona sandboxes with a Nosana summary](docs/screenshot.png)

| | |
| --- | --- |
| Problem | From 2021 to June 2026, 165 of 256 people missing at sea or on the coast in Korea (64.5%) have not been found (Korea Coast Guard data via Rep. Moon Dae-rim, Financial News 2026-09-04). In the Sept 2026 Oryukdo tugboat capsizing, one crew member was found near Pohang, about 100 km from the search area (Nocut News 2026-09-10). |
| Flow | Landing → enter a simulated report (three different incidents off Busan) → estimate → 6-hour 3D/2D playback with the densest 1 km cells highlighted → share text for rescue crews and the control room. |
| Result | Report ~14 km SE of Haeundae, one hour later, share of 2,000 drift paths in the same 1 km cell: fell 15 min earlier 80.7%, reported time 78.3%, fell 15 min later 46.0%, 1 km radius 31.2%. |
| **Daytona** | One Daytona sandbox per case, four at once: create → upload engine, contracts and cached forecast → run → download → delete. Measured about 6–10 s each. |
| **Nosana** | `qwen/qwen3.8-27b` on Nosana inference writes a two-line summary from the computed numbers only (about 3 s). |
| Limits | Simulated reports, cached Open-Meteo current forecast (SHA-256 pinned), one current value per incident, coastline accuracy unverified. Shares are not probabilities. Not official search guidance. The frozen verification criteria cover the first incident (S0–S2, 34.9–35.3°N, 129.0–129.4°E); the -15 min case, incidents 2–3 and the widened demo area are marked `PRESET_NOT_IN_FROZEN_CRITERIA`. |

Built at Daytona HackSprint Seoul, 2026-10-18.

---

## 한국어

해상 실종 신고 하나로 실종자가 표류했을 위치를 추정합니다. 신고로는 위치와 시각을 대략만 알기 때문에, 빠진 시각 ±15분과 위치 반경 1 km를 바꾼 네 가지 경우를 동시에 계산해 나란히 보여 줍니다.

- 흐름: 랜딩 → 가상 신고 입력(부산 앞바다 서로 다른 사고 3건) → 추정 위치 계산 → 6시간 재생(3D/2D, 경우의 수가 많이 모인 1 km 칸 표시) → 출동팀·상황실 공유 문구
- 계산: 경우마다 Daytona sandbox 하나, 4개 동시. Nosana 모델이 계산된 숫자로만 두 줄 요약
- 표류 경로 경우의 수 2,000가지 중 같은 1 km 칸에 모인 비율이며 발견·생존 확률이 아닙니다. 공식 수색 안내가 아닙니다.

## 실행

```bash
# 저장된 예보 2개를 private-inputs/drift-cache-v1/ 에 둔다 (해시 불일치 시 SETUP_BLOCKED)
python3 server.py                 # http://127.0.0.1:8787 (랜딩) · /app.html (데모)  (stdlib only)
python3 -m unittest discover -s tests
```

예보 파일이 없으면 화면이 SETUP_BLOCKED를 알리고, UI 개발용 합성 흐름(예보 아님)으로만 보여 줍니다.

## Daytona / Nosana (현장 연결)

- Daytona: `pip install daytona` 후 `DAYTONA_API_KEY`(필요 시 `DAYTONA_API_URL`, `DAYTONA_TARGET`)를 환경 변수로 넣으면 실행 패널에서 "Daytona sandbox"를 고를 수 있습니다. 시나리오마다 sandbox 하나를 만들어 엔진·계약·캐시를 올리고 `python3 -m goldensea.run`을 실행한 뒤 결과를 받고 sandbox를 지웁니다. 단계별 시간(create/upload/exec/download/delete)을 기록합니다.
- Nosana: OpenAI 호환 엔드포인트를 `NOSANA_LLM_URL`(…/v1), `NOSANA_LLM_MODEL`, 필요 시 `NOSANA_API_KEY`로 넣으면 `/api/brief/<batch>`가 계산 숫자만 바꿔 말하는 요약을 만듭니다(새 숫자·확률 표현 금지).
- 로컬 실행은 항상 "로컬 실행 (스폰서 실행 아님)"으로 표시합니다.

## 구조

| 경로 | 내용 |
| --- | --- |
| `goldensea/engine.py` | EQC 투영, 해류(TO)·바람(FROM) 벡터, ≤600초 분할 적분, 상태(ACTIVE/UNRELEASED/DATA_MISSING/OUT_OF_DOMAIN/STRANDED), 원래 N 분모 집계 |
| `goldensea/forcing.py` | 캐시 SHA-256 확인, 요청 index 선택, KST/UTC 정규화, 시간별 구간 |
| `goldensea/run.py` | 시나리오 실행, 10분 프레임, 13/15/18시 평가, 출처·시간 기록 (CLI 겸용) |
| `goldensea/executors.py` | 로컬 / Daytona sandbox 실행 |
| `goldensea/briefing.py` | 선택: Nosana 요약 |
| `server.py`, `web/` | stdlib 서버와 three.js 화면 (three 0.160 로컬 사본 `web/vendor/`, MIT) |
| `contracts/` | 고정 기준(demo-drift-criteria-v1.json, SHA 고정), 초기 입자, 캐시 manifest |
| `tests/test_criteria.py` | 고정 기준 파일에서 기대값을 읽는 테스트 |
| `tools/make_terrain.py` | Copernicus DEM GLO-30 → `web/assets/terrain.png` |

지형: Produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved. 표시용이며 해안선 검증이 아닙니다.
