"""Golden Sea local server (stdlib only).

    python3 server.py            # http://127.0.0.1:8787
    PORT=0 python3 server.py     # pick a free port

API
  GET  /api/config            executors, cache status, briefing status
  POST /api/run               {"scenarios":["S0","S1","S2"],"executor":"local|daytona","source":"cache|synthetic"}
  GET  /api/batch/<id>        progress + results
  POST /api/brief/<id>        optional Nosana briefing for a finished batch
"""
from __future__ import annotations

import json
import os
import threading
import time
import uuid
from datetime import timezone
from concurrent.futures import ThreadPoolExecutor
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from goldensea import briefing
from goldensea.executors import EXECUTORS, daytona_available
from goldensea.forcing import DataError, SetupBlocked, build_forcing, load_entry
from goldensea.scenarios import (DISCLOSURES, EARLIEST, EVAL_END, INCIDENT_LAT, INCIDENT_LON, INCIDENTS, SCENARIOS,
                                 UNITS, InputError, validate, validate_support)

ROOT = Path(__file__).resolve().parent
WEB = ROOT / "web"
CONTRACTS = ROOT / "contracts"
CACHE = Path(os.environ.get("GOLDENSEA_CACHE", ROOT / "private-inputs" / "drift-cache-v1"))
BATCHES: dict[str, dict] = {}
LOCK = threading.Lock()


def cache_status() -> dict:
    manifest = json.loads((CONTRACTS / "cache-manifest.json").read_text())
    out = {}
    for e in manifest["entries"]:
        try:
            _, prov = load_entry(CACHE, e)
            out[e["file"]] = {"status": "OK", "provenance": prov}
        except SetupBlocked as err:
            out[e["file"]] = {"status": "SETUP_BLOCKED", "error": str(err)}
        except Exception as err:
            out[e["file"]] = {"status": "DATA_ERROR", "error": str(err)}
    return out


def support_check() -> None:
    """Cached forecast must cover every sampled instant, checked before any batch exists."""
    manifest = json.loads((CONTRACTS / "cache-manifest.json").read_text())
    entry = next(e for e in manifest["entries"] if e["file"] == "openmeteo_marine.json")
    marine, _ = load_entry(CACHE, entry)
    epoch = EARLIEST.astimezone(timezone.utc)
    validate_support(EARLIEST, EVAL_END, build_forcing(marine, None, epoch).support, epoch)


def start_batch(scenarios: list[str], executor: str, source: str, incident: str = "A") -> str:
    bid = uuid.uuid4().hex[:10]
    batch = {"id": bid, "executor": executor, "source": source, "incident": incident, "created": time.time(),
             "items": {s: {"phase": "queued", "info": {}} for s in scenarios}, "results": {}}
    with LOCK:
        BATCHES[bid] = batch
    run = EXECUTORS[executor]

    def one(sid: str):
        t = time.perf_counter()

        def phase(name, info):
            with LOCK:
                batch["items"][sid] = {"phase": name, "info": info, "since": round(time.perf_counter() - t, 2)}
        try:
            res = run(sid, CACHE, CONTRACTS, source, phase, incident)
        except Exception as e:
            res = {"status": "INFRA_ERROR", "error": str(e)[:500], "scenario": {"id": sid}, "executor": executor}
        res["wall_s"] = round(time.perf_counter() - t, 3)
        with LOCK:
            batch["results"][sid] = res
            batch["items"][sid] = {"phase": "done", "status": res.get("status"), "wall_s": res["wall_s"],
                                   "info": {"sandbox_id": res.get("sandbox_id")}}

    pool = ThreadPoolExecutor(max_workers=len(scenarios))
    for s in scenarios:
        pool.submit(one, s)
    pool.shutdown(wait=False)
    return bid


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=str(WEB), **k)

    def log_message(self, *a):
        pass

    def _json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/api/config":
            ok, why = daytona_available()
            bok, bwhy = briefing.configured()
            return self._json({"executors": {"local": {"available": True},
                                             "daytona": {"available": ok, "reason": why}},
                               "briefing": {"available": bok, "reason": bwhy},
                               "cache": cache_status(),
                               "disclosures": DISCLOSURES,
                               "scenarios": {k: v.echo() for k, v in SCENARIOS.items()}})
        if self.path.startswith("/api/export/"):
            bid = self.path.rsplit("/", 1)[-1]
            with LOCK:
                b = BATCHES.get(bid)
                snap = json.loads(json.dumps(b)) if b else None
            if not snap:
                return self._json({"error": "unknown batch"}, 404)
            body = json.dumps({"golden_sea_export": 1, "batch_id": bid, "executor": snap["executor"],
                               "source": snap["source"], "disclosures": DISCLOSURES, "units": UNITS,
                               "results": snap["results"]}, ensure_ascii=False).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Disposition", f'attachment; filename="golden-sea-{bid}.json"')
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if self.path.startswith("/api/batch/"):
            bid = self.path.rsplit("/", 1)[-1]
            with LOCK:
                b = BATCHES.get(bid)
                snap = json.loads(json.dumps(b)) if b else None
            return self._json(snap or {"error": "unknown batch"}, 200 if snap else 404)
        return super().do_GET()

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        try:
            body = json.loads(self.rfile.read(n) or b"{}")
        except json.JSONDecodeError:
            return self._json({"status": "INPUT_ERROR", "error": "invalid JSON"}, 400)
        if self.path == "/api/run":
            scen = body.get("scenarios") or ["S6", "S5", "S0", "S2", "S7", "S8", "S1"]
            ex = body.get("executor", "local")
            src = body.get("source", "cache")
            inc = body.get("incident", "A")
            if inc not in INCIDENTS:
                return self._json({"status": "INPUT_ERROR", "error": "unknown incident", "new_run": False}, 400)
            if any(s not in SCENARIOS for s in scen) or ex not in EXECUTORS or src not in ("cache", "synthetic"):
                return self._json({"status": "INPUT_ERROR", "error": "unknown scenario/executor/source"}, 400)
            try:
                for s in scen:
                    sc = SCENARIOS[s]
                    validate(INCIDENTS[inc]["lat"], INCIDENTS[inc]["lon"], sc.radius_m, EARLIEST, sc.latest_release, EVAL_END, sc.alpha)
                if src == "cache":
                    support_check()
            except InputError as e:
                return self._json({"status": "INPUT_ERROR", "error": str(e), "new_run": False}, 400)
            except (SetupBlocked, DataError) as e:
                return self._json({"status": "SETUP_BLOCKED" if isinstance(e, SetupBlocked) else "DATA_ERROR",
                                   "error": str(e), "new_run": False}, 409)
            if ex == "daytona" and not daytona_available()[0]:
                return self._json({"status": "SETUP_BLOCKED", "error": daytona_available()[1]}, 409)
            return self._json({"batch_id": start_batch(scen, ex, src, inc)})
        if self.path.startswith("/api/brief/"):
            bid = self.path.rsplit("/", 1)[-1]
            with LOCK:
                b = BATCHES.get(bid)
                results = list(b["results"].values()) if b else []
            return self._json(briefing.summarise(results))
        return self._json({"error": "not found"}, 404)


def main():
    port = int(os.environ.get("PORT", "8787"))
    srv = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"Golden Sea on http://127.0.0.1:{srv.server_address[1]}", flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
