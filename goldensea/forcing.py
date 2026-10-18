"""Cached forecast loading with byte-level provenance.

The frozen demo uses two archived Open-Meteo responses (marine current, GFS
10 m wind). Their SHA-256 values are fixed in contracts/cache-manifest.json.
If a file is missing or its bytes differ, loading fails with SETUP_BLOCKED;
we never silently fetch a fresh response instead.
"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

from .engine import Forcing, Segment, current_to_uv, wind_from_uv


class SetupBlocked(Exception):
    """Cache missing or hash mismatch. Not a product or model failure."""


class DataError(Exception):
    """Cache present but unusable (shape, units, time support)."""


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def provider_time_to_utc(local_iso: str, utc_offset_seconds: int) -> datetime:
    """Open-Meteo returns naive local times plus an offset."""
    naive = datetime.fromisoformat(local_iso)
    return (naive - timedelta(seconds=utc_offset_seconds)).replace(tzinfo=timezone.utc)


def load_entry(cache_dir: Path, entry: dict) -> tuple[dict, dict]:
    path = cache_dir / entry["file"]
    if not path.exists():
        raise SetupBlocked(f"cache file missing: {entry['file']}")
    digest = sha256_file(path)
    if digest != entry["sha256"]:
        raise SetupBlocked(f"sha256 mismatch for {entry['file']}: {digest}")
    data = json.loads(path.read_bytes())
    if not isinstance(data, list):
        raise DataError("expected a multi-location response list")
    idx = entry["request_list_index_zero_based"]
    if idx >= len(data):
        raise DataError("request index outside response list")
    provenance = {
        "provider": "open-meteo",
        "file": entry["file"],
        "request_url": entry["request_url"],
        "requested_point": entry["requested_lat_lon"],
        "returned_point": [data[idx].get("latitude"), data[idx].get("longitude")],
        "manifest_returned_point": entry["returned_lat_lon"],
        "received_at": None,
        "received_at_label": "unknown",
        "probe_start": entry.get("retrieval_started_at"),
        "probe_start_label": "retrieval_started_at is probe start, not exact received time",
        "time_span": entry["time_span"],
        "units": entry["units"],
        "sha256": digest,
        "publication_time_label": "unknown",
        "separation_m": entry.get("requested_to_returned_eqc_separation_m"),
    }
    return data[idx], provenance


def build_forcing(marine: dict, wind: dict | None, epoch: datetime) -> Forcing:
    """Hourly left-closed right-open segments in seconds since epoch (UTC)."""
    mh = marine["hourly"]
    off = marine.get("utc_offset_seconds", 0)
    times = [provider_time_to_utc(t, off) for t in mh["time"]]
    wind_by_time = {}
    if wind is not None:
        wh = wind["hourly"]
        woff = wind.get("utc_offset_seconds", 0)
        for t, s, d in zip(wh["time"], wh["wind_speed_10m"], wh["wind_direction_10m"]):
            wind_by_time[provider_time_to_utc(t, woff)] = wind_from_uv(s, d)
    segs = []
    for i, t0 in enumerate(times):
        t1 = times[i + 1] if i + 1 < len(times) else t0 + timedelta(hours=1)
        cur = current_to_uv(mh["ocean_current_velocity"][i], mh["ocean_current_direction"][i])
        segs.append(Segment((t0 - epoch).total_seconds(), (t1 - epoch).total_seconds(),
                            cur, wind_by_time.get(t0)))
    return Forcing(segs)
