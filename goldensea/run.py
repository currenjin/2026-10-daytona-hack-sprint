"""Run one scenario end to end and return a JSON-serialisable result.

Usable as a library (local executor) and as a CLI inside a Daytona sandbox:
    python -m goldensea.run --scenario S0 --cache private-inputs/drift-cache-v1 \
        --contracts contracts --out result.json --executor daytona
"""
from __future__ import annotations

import argparse
import hashlib
import json
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

from .engine import Box, Particle, Projection, bin_counts, simulate_frames
from .forcing import DataError, SetupBlocked, build_forcing, load_entry
from .scenarios import (DOMAIN_LAT, DOMAIN_LON, EARLIEST, EVAL_END, EVAL_TIMES, INCIDENT_LAT,
                        INCIDENT_LON, SCENARIOS, validate)

ROOT = Path(__file__).resolve().parent.parent
LATENT_SHA256 = "4441c7371bcf0cf7f3ab032843509f168a00d33dbbd49cba6e79c94b2a3f6884"
EPOCH = EARLIEST.astimezone(timezone.utc)


def load_latent(contracts: Path) -> list[list[float]]:
    path = contracts / "demo-drift-initial-particles-v1.json"
    raw = path.read_bytes()
    if hashlib.sha256(raw).hexdigest() != LATENT_SHA256:
        raise SetupBlocked("latent particle fixture hash mismatch")
    return json.loads(raw)["particles"]


def make_particles(latent, radius_m: float, latest: datetime) -> list[Particle]:
    span = (latest - EARLIEST).total_seconds()
    return [Particle(radius_m * ue, radius_m * un, span * ru) for ue, un, ru in latent]


def domain_box(proj: Projection) -> Box:
    x0, y0 = proj.to_xy(DOMAIN_LAT[0], DOMAIN_LON[0])
    x1, y1 = proj.to_xy(DOMAIN_LAT[1], DOMAIN_LON[1])
    return Box(x0, x1, y0, y1)


def run_scenario(scenario_id: str, cache_dir: Path, contracts: Path, executor: str = "local",
                 source: str = "cache") -> dict:
    sc = SCENARIOS[scenario_id]
    run = {
        "run_id": uuid.uuid4().hex[:12],
        "scenario": sc.echo(),
        "executor": executor,
        "executor_label": "local run (not a sponsor execution)" if executor == "local" else executor,
        "started_at": datetime.now(timezone.utc).isoformat(),
        "incident": {"lat": INCIDENT_LAT, "lon": INCIDENT_LON,
                     "earliest_release": EARLIEST.isoformat(), "latest_release": sc.latest_release.isoformat()},
        "quality_flags": ["COASTLINE_UNVERIFIED", "SURFACE_CURRENT_UNVERIFIED"]
                         + (["WIND_ADAPTER_UNVERIFIED"] if sc.alpha else []),
        "stranding_fraction": None,
        "input_source": source,
        "input_label": ("저장된 예보 (고정 캐시)" if source == "cache"
                        else "합성 흐름 · UI 개발용 · 예보 아님"),
    }
    t0 = time.perf_counter()
    if source == "synthetic":
        return {**run, **synthetic_run(sc, contracts, t0), "status": "OK_SYNTHETIC"}
    try:
        validate(INCIDENT_LAT, INCIDENT_LON, sc.radius_m, EARLIEST, sc.latest_release, EVAL_END, sc.alpha)
        manifest = json.loads((contracts / "cache-manifest.json").read_text())
        entries = {e["file"]: e for e in manifest["entries"]}
        marine, prov_m = load_entry(cache_dir, entries["openmeteo_marine.json"])
        wind, prov_w = (load_entry(cache_dir, entries["openmeteo_wind_gfs_global.json"])
                        if sc.alpha else (None, None))
        latent = load_latent(contracts)
    except SetupBlocked as e:
        return {**run, "status": "SETUP_BLOCKED", "error": str(e)}
    except DataError as e:
        return {**run, "status": "DATA_ERROR", "error": str(e)}
    t_load = time.perf_counter()

    forcing = build_forcing(marine, wind, EPOCH)
    proj = Projection(INCIDENT_LAT, INCIDENT_LON)
    dom = domain_box(proj)
    return {**run, **simulate(latent, sc, forcing, dom, proj, t0, t_load), "status": "OK",
            "provenance": {"current": prov_m, "wind": prov_w}}


FRAME_STEP_S = 600


def synthetic_run(sc, contracts: Path, t0) -> dict:
    """Clearly labelled synthetic flow for UI development without the cache."""
    from .engine import Forcing, Segment
    import math as _m
    segs = []
    for h in range(0, 8):
        ang = _m.radians(40 + 12 * _m.sin(h / 2))
        spd = 0.35 + 0.08 * _m.cos(h / 3)
        segs.append(Segment(h * 3600.0, (h + 1) * 3600.0, (spd * _m.sin(ang), spd * _m.cos(ang))))
    latent = load_latent(contracts)
    t_load = time.perf_counter()
    proj = Projection(INCIDENT_LAT, INCIDENT_LON)
    return simulate(latent, sc, Forcing(segs), domain_box(proj), proj, t0, t_load)


def simulate(latent, sc, forcing, dom, proj, t0, t_load) -> dict:
    eval_s = {round((t - EARLIEST).total_seconds()): t for t in EVAL_TIMES}
    horizon = (EVAL_END - EARLIEST).total_seconds()
    frame_times = [float(t) for t in range(0, int(horizon) + 1, FRAME_STEP_S)]
    ps = make_particles(latent, sc.radius_m, sc.latest_release)
    frames, evaluations = [], []
    for t, snap in simulate_frames(ps, forcing, sc.alpha, frame_times, domain=dom):
        frames.append({"t": t, "xy": [v for x, y, _ in snap for v in (round(x), round(y))],
                       "s": "".join(st[0] for _, _, st in snap)})
        if round(t) in eval_s:
            agg = bin_counts(ps, 1000.0)
            top = max(agg["cell_fractions"].items(), key=lambda kv: kv[1], default=(None, 0))
            evaluations.append({"at": eval_s[round(t)].isoformat(), **agg,
                                "top_cell": top[0], "top_cell_fraction": top[1]})
    t_calc = time.perf_counter()
    return {
        "frame_step_s": FRAME_STEP_S,
        "frame_origin": EARLIEST.isoformat(),
        "frame_units": "metres east/north of incident (local EQC); state letters A,U,D,O,S",
        "frames": frames,
        "evaluations": evaluations,
        "timings_s": {"load": round(t_load - t0, 4), "compute": round(t_calc - t_load, 4)},
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--scenario", required=True, choices=sorted(SCENARIOS))
    ap.add_argument("--cache", default=str(ROOT / "private-inputs" / "drift-cache-v1"))
    ap.add_argument("--contracts", default=str(ROOT / "contracts"))
    ap.add_argument("--executor", default="local")
    ap.add_argument("--source", default="cache", choices=["cache", "synthetic"])
    ap.add_argument("--out")
    a = ap.parse_args()
    res = run_scenario(a.scenario, Path(a.cache), Path(a.contracts), a.executor, a.source)
    text = json.dumps(res, ensure_ascii=False)
    if a.out:
        Path(a.out).write_text(text)
    else:
        print(text)


if __name__ == "__main__":
    main()
