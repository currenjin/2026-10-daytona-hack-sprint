"""Run one scenario end to end and return a JSON-serialisable result.

Usable as a library (local executor) and as a CLI inside a Daytona sandbox:
    python -m goldensea.run --scenario S0 --cache private-inputs/drift-cache-v1 \
        --contracts contracts --out result.json --executor daytona
"""
from __future__ import annotations

import argparse
import hashlib
import math
import json
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from .engine import Box, Particle, Projection, bin_counts, simulate_frames
from .forcing import DataError, SetupBlocked, build_forcing, load_entry
from .scenarios import (DOMAIN_LAT, DOMAIN_LON, EARLIEST, EVAL_END, EVAL_TIMES, INCIDENT_LAT,
                        INCIDENT_LON, INCIDENTS, SCENARIOS, DISCLOSURES, UNITS, InputError, validate,
                        validate_support)

ROOT = Path(__file__).resolve().parent.parent
LATENT_SHA256 = "4441c7371bcf0cf7f3ab032843509f168a00d33dbbd49cba6e79c94b2a3f6884"
EPOCH = EARLIEST.astimezone(timezone.utc)


def load_latent(contracts: Path) -> list[list[float]]:
    path = contracts / "demo-drift-initial-particles-v1.json"
    raw = path.read_bytes()
    if hashlib.sha256(raw).hexdigest() != LATENT_SHA256:
        raise SetupBlocked("latent particle fixture hash mismatch")
    return json.loads(raw)["particles"]


def make_particles(latent, radius_m: float, latest: datetime, start: datetime = EARLIEST,
                   first: datetime | None = None) -> list[Particle]:
    first = first or start
    base, span = (first - start).total_seconds(), (latest - first).total_seconds()
    return [Particle(radius_m * ue, radius_m * un, base + span * ru) for ue, un, ru in latent]


def domain_box(proj: Projection) -> Box:
    x0, y0 = proj.to_xy(DOMAIN_LAT[0], DOMAIN_LON[0])
    x1, y1 = proj.to_xy(DOMAIN_LAT[1], DOMAIN_LON[1])
    return Box(x0, x1, y0, y1)


def run_scenario(scenario_id: str, cache_dir: Path, contracts: Path, executor: str = "local",
                 source: str = "cache", incident: str = "A") -> dict:
    sc = SCENARIOS[scenario_id]
    inc = INCIDENTS[incident]
    lat0, lon0 = inc["lat"], inc["lon"]
    # each report has its own time window; the frozen incident A keeps 12:00
    shift = timedelta(minutes=inc.get("offset_min", 0))
    start, latest, eval_end = EARLIEST + shift, sc.latest_release + shift, EVAL_END + shift
    eval_times = [t + shift for t in EVAL_TIMES]
    run = {
        "run_id": uuid.uuid4().hex[:12],
        "scenario": sc.echo(),
        "executor": executor,
        "executor_label": "local run (not a sponsor execution)" if executor == "local" else executor,
        "started_at": datetime.now(timezone.utc).isoformat(),
        "incident": {"id": incident, "lat": lat0, "lon": lon0, "label": inc["label"],
                     "in_frozen_criteria": inc["verified"],
                     "earliest_release": start.isoformat(), "latest_release": latest.isoformat()},
        "quality_flags": ["COASTLINE_UNVERIFIED", "SURFACE_CURRENT_UNVERIFIED"]
                         + (["WIND_ADAPTER_UNVERIFIED"] if sc.alpha else [])
                         + ([] if inc["verified"] and sc.id in ("S0", "S1", "S2") else ["PRESET_NOT_IN_FROZEN_CRITERIA"]),
        "stranding_fraction": None,
        "disclosures": DISCLOSURES,
        "units": UNITS,
        "input_source": source,
        "input_label": ("저장된 예보 (고정 캐시)" if source == "cache"
                        else "합성 흐름 · UI 개발용 · 예보 아님"),
    }
    t0 = time.perf_counter()
    try:
        validate(lat0, lon0, sc.radius_m, start, latest, eval_end, sc.alpha)
    except InputError as e:
        return {**run, "status": "INPUT_ERROR", "error": str(e)}
    if source == "synthetic":
        return {**run, **synthetic_run(sc, contracts, t0), "status": "OK_SYNTHETIC"}
    try:
        manifest = json.loads((contracts / "cache-manifest.json").read_text())
        entries = {e["file"]: e for e in manifest["entries"]}
        m_entry = dict(entries["openmeteo_marine.json"])
        if incident != "A":
            m_entry.update(request_list_index_zero_based=inc["cache_index"], requested_lat_lon=[lat0, lon0],
                           requested_to_returned_eqc_separation_m=None)
        marine, prov_m = load_entry(cache_dir, m_entry)
        wind, prov_w = (load_entry(cache_dir, entries["openmeteo_wind_gfs_global.json"])
                        if sc.alpha else (None, None))
        latent = load_latent(contracts)
    except SetupBlocked as e:
        return {**run, "status": "SETUP_BLOCKED", "error": str(e)}
    except DataError as e:
        return {**run, "status": "DATA_ERROR", "error": str(e)}
    t_load = time.perf_counter()

    epoch = start.astimezone(timezone.utc)
    forcing = build_forcing(marine, wind, epoch)
    try:
        validate_support(start, eval_end, forcing.support, epoch)
    except InputError as e:
        return {**run, "status": "INPUT_ERROR", "error": str(e)}
    proj = Projection(lat0, lon0)
    dom = domain_box(proj)
    return {**run, **simulate(latent, sc, forcing, dom, proj, t0, t_load, start, latest, eval_times, eval_end),
            "status": "OK",
            "provenance": {"current": prov_m, "wind": prov_w}}


FRAME_STEP_S = 600


def cell_round(v: float) -> int:
    """Nearest integer metre that stays in the same 1 km cell as v."""
    r = round(v)
    return r if math.floor(r / 1000) == math.floor(v / 1000) else math.floor(v)


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


def simulate(latent, sc, forcing, dom, proj, t0, t_load, start=EARLIEST, latest=None, eval_times=EVAL_TIMES,
             eval_end=EVAL_END) -> dict:
    eval_s = {round((t - start).total_seconds()): t for t in eval_times}
    horizon = (eval_end - start).total_seconds()
    frame_times = [float(t) for t in range(0, int(horizon) + 1, FRAME_STEP_S)]
    first = start + timedelta(minutes=getattr(sc, "earliest_shift_min", 0))
    ps = make_particles(latent, sc.radius_m, latest or sc.latest_release, start, first)
    frames, evaluations = [], []
    for t, snap in simulate_frames(ps, forcing, sc.alpha, frame_times, domain=dom):
        frames.append({"t": t, "xy": [v for x, y, _ in snap for v in (cell_round(x), cell_round(y))],
                       "s": "".join(st[0] for _, _, st in snap)})
        if round(t) in eval_s:
            agg = bin_counts(ps, 1000.0)
            top = max(agg["cell_fractions"].items(), key=lambda kv: kv[1], default=(None, 0))
            evaluations.append({"at": eval_s[round(t)].isoformat(), **agg,
                                "top_cell": top[0], "top_cell_fraction": top[1]})
    t_calc = time.perf_counter()
    return {
        "frame_step_s": FRAME_STEP_S,
        "frame_origin": start.isoformat(),
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
    ap.add_argument("--incident", default="A", choices=sorted(INCIDENTS))
    ap.add_argument("--out")
    a = ap.parse_args()
    res = run_scenario(a.scenario, Path(a.cache), Path(a.contracts), a.executor, a.source, a.incident)
    text = json.dumps(res, ensure_ascii=False)
    if a.out:
        Path(a.out).write_text(text)
    else:
        print(text)


if __name__ == "__main__":
    main()
