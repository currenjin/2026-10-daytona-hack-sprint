"""Optional plain-language briefing from an OpenAI-compatible endpoint (Nosana).

Configure with NOSANA_LLM_URL (base URL ending in /v1), NOSANA_LLM_MODEL and
optionally NOSANA_API_KEY. The model only rephrases numbers already computed;
the prompt forbids new numbers, probabilities or search advice.
"""
from __future__ import annotations

import json
import os
import time
import urllib.request

SYSTEM = (
    "너는 해상 표류 시뮬레이션 결과를 짧게 요약한다. 주어진 숫자만 쓰고 새 숫자를 만들지 마라. "
    "입자 비율을 발견 확률이나 생존 확률로 표현하지 마라. 수색 지시를 하지 마라. 세 문장 이내 한국어."
)


def configured() -> tuple[bool, str]:
    if not os.environ.get("NOSANA_LLM_URL"):
        return False, "NOSANA_LLM_URL not set"
    return True, "configured"


def summarise(results: list[dict]) -> dict:
    ok, why = configured()
    if not ok:
        return {"status": "NOT_CONFIGURED", "reason": why}
    facts = [{"scenario": r.get("scenario", {}).get("id"),
              "evaluations": [{"at": e["at"], "top_cell_fraction": e["top_cell_fraction"],
                               "unresolved_fraction": e["unresolved_fraction"]} for e in r.get("evaluations", [])]}
             for r in results if r.get("evaluations")]
    body = {"model": os.environ.get("NOSANA_LLM_MODEL", "default"),
            "messages": [{"role": "system", "content": SYSTEM},
                         {"role": "user", "content": json.dumps(facts, ensure_ascii=False)}],
            "temperature": 0}
    req = urllib.request.Request(os.environ["NOSANA_LLM_URL"].rstrip("/") + "/chat/completions",
                                 data=json.dumps(body).encode(), method="POST",
                                 headers={"Content-Type": "application/json",
                                          **({"Authorization": f"Bearer {os.environ['NOSANA_API_KEY']}"}
                                             if os.environ.get("NOSANA_API_KEY") else {})})
    t = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            out = json.loads(r.read())
    except Exception as e:
        return {"status": "INFRA_ERROR", "error": str(e)[:300]}
    return {"status": "OK", "provider": "nosana", "latency_s": round(time.perf_counter() - t, 3),
            "text": out["choices"][0]["message"]["content"], "label": "모델 요약 · 숫자는 계산 결과에서만"}
