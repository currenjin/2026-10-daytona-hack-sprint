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
    "비율을 발견 확률이나 생존 확률로 표현하지 마라. 수색 지시를 하지 마라. 세 문장 이내 한국어. 비율은 '표류 경로 경우의 수 2,000가지 중 같은 1 km 칸에 모인 비율'이라고 부르고 퍼센트로 쓴다. '입자'라는 말은 쓰지 마라. "
    "시나리오는 주어진 이름 그대로 부르고 S0 같은 기호를 만들지 마라. 첫 문장은 첫 번째 비교 시각, 둘째는 두 번째 비교 시각을 주어진 시각 그대로 쓴다. unresolved_fraction이 1이면 0%라고 하지 말고 "
    "'모든 경로가 시연 해역 밖으로 나가 미확인'이라고 쓴다."
)


def configured() -> tuple[bool, str]:
    if not os.environ.get("NOSANA_LLM_URL"):
        return False, "NOSANA_LLM_URL not set"
    return True, "configured"


def summarise(results: list[dict]) -> dict:
    ok, why = configured()
    if not ok:
        return {"status": "NOT_CONFIGURED", "reason": why}
    names = {"S6": "30분 일찍 빠졌다면", "S5": "15분 일찍 빠졌다면", "S0": "신고 시각", "S2": "15분 늦게 빠졌다면", "S7": "30분 늦게 빠졌다면", "S8": "신고 위치 500 m 반경", "S1": "신고 위치 1 km 반경"}
    facts = [{"scenario": names.get(r.get("scenario", {}).get("id"), r.get("scenario", {}).get("id")),
              "evaluations": [{"at": e["at"][11:16] + " KST", "top_cell_fraction": e["top_cell_fraction"],
                               "unresolved_fraction": e["unresolved_fraction"]} for e in r.get("evaluations", [])]}
             for r in results if r.get("evaluations")]
    body = {"model": os.environ.get("NOSANA_LLM_MODEL", "default"),
            "messages": [{"role": "system", "content": SYSTEM},
                         {"role": "user", "content": json.dumps(facts, ensure_ascii=False)}],
            "temperature": 0, "max_tokens": 600,
            "chat_template_kwargs": {"enable_thinking": False}}
    req = urllib.request.Request(os.environ["NOSANA_LLM_URL"].rstrip("/") + "/chat/completions",
                                 data=json.dumps(body).encode(), method="POST",
                                 headers={"Content-Type": "application/json",
                                          **({"Authorization": f"Bearer {os.environ['NOSANA_API_KEY']}"}
                                             if os.environ.get("NOSANA_API_KEY") else {})})
    t = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            out = json.loads(r.read())
    except Exception as e:
        return {"status": "INFRA_ERROR", "error": str(e)[:300]}
    import re
    text = re.sub(r"<think>.*?</think>", "", out["choices"][0]["message"]["content"] or "", flags=re.S).strip()
    return {"status": "OK", "provider": "nosana", "model": body["model"],
            "latency_s": round(time.perf_counter() - t, 3), "text": text,
            "label": "Nosana 모델 요약 · 숫자는 계산 결과에서만"}


def _chat(system: str, user: str, max_tokens: int = 500) -> dict:
    ok, why = configured()
    if not ok:
        return {"status": "NOT_CONFIGURED", "reason": why}
    body = {"model": os.environ.get("NOSANA_LLM_MODEL", "default"),
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
            "temperature": 0, "max_tokens": max_tokens, "chat_template_kwargs": {"enable_thinking": False}}
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
    import re
    text = re.sub(r"<think>.*?</think>", "", out["choices"][0]["message"]["content"] or "", flags=re.S).strip()
    return {"status": "OK", "model": body["model"], "latency_s": round(time.perf_counter() - t, 3), "text": text}


PARSE = (
    "너는 해상 실종 신고문을 접수 양식으로 정리한다. 신고문에 있는 말만 쓰고 없는 값은 빈 문자열로 둔다. "
    "JSON 하나만 출력한다. 키: when(접수 시각 HH:MM), who(신고자와 경로), what(무슨 일인지 한 줄), "
    "pos(위도·경도 그대로), ref(기준 지점과 거리), time(빠진 시각 범위 'HH:MM ~ HH:MM'), err(위치 오차)."
)


def parse_report(text: str) -> dict:
    res = _chat(PARSE, text, 300)
    if res.get("status") != "OK":
        return res
    import re
    m = re.search(r"\{.*\}", res["text"], flags=re.S)
    try:
        fields = json.loads(m.group(0)) if m else None
    except json.JSONDecodeError:
        fields = None
    if not isinstance(fields, dict):
        return {"status": "MODEL_ERROR", "raw": res["text"][:300], "latency_s": res["latency_s"]}
    keep = {k: str(fields.get(k, "")) for k in ("when", "who", "what", "pos", "ref", "time", "err")}
    return {"status": "OK", "fields": keep, "model": res["model"], "latency_s": res["latency_s"]}


DISPATCH = (
    "너는 해양경찰 상황실 담당자다. 주어진 신고와 계산 결과로 출동 함정·항공대·상황실에 보낼 상황 공유 문구를 쓴다. "
    "주어진 숫자와 좌표만 그대로 쓰고 새 숫자를 만들지 마라. 확률이라고 쓰지 마라. 수색 지시를 하지 말고 상황 공유로 쓴다. "
    "신고 내용은 주어진 '신고' 문장을 그대로 옮기고 다른 말로 바꾸지 마라(예: '투신' 같은 표현 금지). 형식: 첫 줄 [상황 공유], 그다음 줄에 신고 문장 그대로. 그다음 결과의 첫 번째 시각만 골라 '■ HH:MM KST' 한 줄, "
    "그 아래 주어진 경우를 하나도 빼지 말고 경우마다 '- 경우 이름: 칸 중심 좌표 · 비율' 한 줄씩. "
    "마지막 줄 '비율은 표류 경로 경우의 수 2,000가지 중 몫이며 확률이 아님. 판단은 상황실'. 한국어."
)


def dispatch_message(facts: dict) -> dict:
    res = _chat(DISPATCH, json.dumps(facts, ensure_ascii=False), 700)
    if res.get("status") == "OK":
        res["label"] = "Nosana 모델 작성 · 숫자는 계산 결과에서만"
    return res
