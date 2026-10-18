"""Frozen demo scope and scenario definitions (S0-S4).

Values come from contracts/demo-drift-criteria-v1.json `scope`. They are
technical defaults for a synthetic incident, not a real accident.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, asdict
from datetime import datetime, timezone, timedelta

KST = timezone(timedelta(hours=9))

INCIDENT_LAT, INCIDENT_LON = 35.1, 129.3
DOMAIN_LAT = (34.9, 35.3)
DOMAIN_LON = (129.0, 129.4)
EARLIEST = datetime(2026, 10, 18, 12, 0, tzinfo=KST)
LATEST = datetime(2026, 10, 18, 12, 15, tzinfo=KST)
EVAL_END = datetime(2026, 10, 18, 18, 0, tzinfo=KST)
EVAL_TIMES = [datetime(2026, 10, 18, h, 0, tzinfo=KST) for h in (13, 15, 18)]
N_PARTICLES = 2000
SUPPORTED_ALPHA = (0.0, 0.01, 0.03)


@dataclass(frozen=True)
class Scenario:
    id: str
    label: str
    radius_m: float
    latest_release: datetime
    alpha: float
    changed: str
    required: bool = True

    def echo(self) -> dict:
        d = asdict(self)
        d["latest_release"] = self.latest_release.isoformat()
        d["earliest_release"] = EARLIEST.isoformat()
        return d


SCENARIOS = {
    "S0": Scenario("S0", "기준안", 250, LATEST, 0.0, "—"),
    "S1": Scenario("S1", "반경 1,000 m", 1000, LATEST, 0.0, "radius_m"),
    "S2": Scenario("S2", "투입 ~12:30", 250, datetime(2026, 10, 18, 12, 30, tzinfo=KST), 0.0, "latest_release"),
    "S3": Scenario("S3", "바람 계수 0.01", 250, LATEST, 0.01, "alpha", required=False),
    "S4": Scenario("S4", "바람 계수 0.03", 250, LATEST, 0.03, "alpha", required=False),
}


class InputError(ValueError):
    """Invalid request: no new run is created."""


def validate(lat: float, lon: float, radius_m: float, earliest: datetime, latest: datetime,
             eval_end: datetime, alpha: float) -> None:
    for v in (lat, lon, radius_m, alpha):
        if v is None or not isinstance(v, (int, float)) or math.isnan(v) or math.isinf(v):
            raise InputError("non-finite input")
    if radius_m < 0 or radius_m > 1000:
        raise InputError("radius must be within 0-1000 m")
    if alpha not in SUPPORTED_ALPHA:
        raise InputError("unsupported alpha")
    if earliest > latest or latest > eval_end:
        raise InputError("release window must satisfy earliest <= latest <= evaluation end")
    if not (DOMAIN_LAT[0] <= lat <= DOMAIN_LAT[1] and DOMAIN_LON[0] <= lon <= DOMAIN_LON[1]):
        raise InputError("incident outside demo domain")
