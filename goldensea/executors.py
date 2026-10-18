"""Where a scenario runs: in-process (local) or one Daytona sandbox per scenario.

Daytona credentials come only from the environment (DAYTONA_API_KEY and
optional DAYTONA_API_URL / DAYTONA_TARGET, read by the SDK). A local run is
always labelled local and never reported as a sponsor execution.
"""
from __future__ import annotations

import json
import os
import time
from pathlib import Path

from .run import ROOT, run_scenario

CODE_FILES = ["__init__.py", "engine.py", "forcing.py", "scenarios.py", "run.py"]
CONTRACT_FILES = ["cache-manifest.json", "demo-drift-initial-particles-v1.json"]
CACHE_FILES = ["openmeteo_marine.json", "openmeteo_wind_gfs_global.json"]


def daytona_available() -> tuple[bool, str]:
    if not os.environ.get("DAYTONA_API_KEY"):
        return False, "DAYTONA_API_KEY not set"
    try:
        import daytona  # noqa: F401
    except ImportError:
        return False, "python package 'daytona' not installed"
    return True, "configured"


def run_local(scenario_id: str, cache_dir: Path, contracts: Path, source: str, on_phase=None,
              incident: str = "A") -> dict:
    if on_phase:
        on_phase("running", {})
    return run_scenario(scenario_id, cache_dir, contracts, "local", source, incident)


def run_daytona(scenario_id: str, cache_dir: Path, contracts: Path, source: str, on_phase=None,
                incident: str = "A") -> dict:
    from daytona import Daytona

    phase = on_phase or (lambda *_: None)
    timings: dict[str, float] = {}
    t = time.perf_counter()
    client = Daytona()
    phase("creating_sandbox", {})
    sandbox = client.create()
    timings["create_s"] = round(time.perf_counter() - t, 3)
    sandbox_id = getattr(sandbox, "id", None)
    try:
        phase("uploading", {"sandbox_id": sandbox_id})
        t = time.perf_counter()
        pkg = ROOT / "goldensea"
        for f in CODE_FILES:
            sandbox.fs.upload_file((pkg / f).read_bytes(), f"gs/goldensea/{f}")
        for f in CONTRACT_FILES:
            sandbox.fs.upload_file((contracts / f).read_bytes(), f"gs/contracts/{f}")
        if source == "cache":
            for f in CACHE_FILES:
                if (cache_dir / f).exists():
                    sandbox.fs.upload_file((cache_dir / f).read_bytes(), f"gs/cache/{f}")
        timings["upload_s"] = round(time.perf_counter() - t, 3)
        phase("running", {"sandbox_id": sandbox_id})
        t = time.perf_counter()
        cmd = (f"cd gs && python3 -m goldensea.run --scenario {scenario_id} --cache cache "
               f"--contracts contracts --executor daytona --source {source} --incident {incident} --out out.json")
        resp = sandbox.process.exec(cmd, timeout=300)
        timings["exec_s"] = round(time.perf_counter() - t, 3)
        if resp.exit_code != 0:
            return {"status": "INFRA_ERROR", "executor": "daytona", "sandbox_id": sandbox_id,
                    "error": (resp.result or "")[-800:], "executor_timings_s": timings,
                    "scenario": {"id": scenario_id}}
        phase("downloading", {"sandbox_id": sandbox_id})
        t = time.perf_counter()
        result = json.loads(sandbox.fs.download_file("gs/out.json"))
        timings["download_s"] = round(time.perf_counter() - t, 3)
    finally:
        phase("deleting", {"sandbox_id": sandbox_id})
        t = time.perf_counter()
        try:
            client.delete(sandbox)
            timings["delete_s"] = round(time.perf_counter() - t, 3)
        except Exception as e:  # cleanup failure is reported, not hidden
            timings["delete_error"] = str(e)[:200]
    result["executor"] = "daytona"
    result["executor_label"] = "Daytona sandbox"
    result["sandbox_id"] = sandbox_id
    result["executor_timings_s"] = timings
    return result


EXECUTORS = {"local": run_local, "daytona": run_daytona}
