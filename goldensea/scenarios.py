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


class LandRejected(InputError):
    """Initial position lies on known (synthetic) land: REJECTED_LAND."""


# The nine limits shown in the UI dialog and carried in every exported run.
DISCLOSURES = [
    {"id": "synthetic_incident", "ko": "합성 사고 · 실제 사고 재현 아님", "en": "Synthetic incident, not a real accident"},
    {"id": "cached_forecast", "ko": "저장된 예보 · 수신 시각 미확인 (탐침 시작 시각은 별도 표시)",
     "en": "Cached forecast; exact receipt time unknown; probe start is labeled separately"},
    {"id": "particle_share", "ko": "입자 비율 ≠ 발견·생존 확률", "en": "Particle share is not a discovery or survival probability"},
    {"id": "coastal_accuracy", "ko": "해안 정확도 미검증", "en": "Coastal accuracy unverified"},
    {"id": "wind_coefficient", "ko": "바람 계수는 보정 안 된 가정값 (사용 시)", "en": "Wind coefficient is an uncalibrated assumption (if alpha is nonzero)"},
    {"id": "not_official", "ko": "공식 수색 안내 아님 · 판단은 사람이", "en": "Not official search guidance; people decide"},
    {"id": "single_point_current", "ko": "해류 한 지점 값을 모든 입자에 적용 · 퍼짐은 초기 위치·투입 시각 가정만 반영",
     "en": "Single-point spatially uniform current; spread reflects initial position/time assumptions, not sampled flow uncertainty"},
    {"id": "land_crossing", "ko": "실제 해안선 미검증 · 입자가 육지를 지날 수 있음", "en": "ACTIVE particles may cross real land: real coastline unverified"},
    {"id": "source_locations", "ko": "요청·반환 위치 약 2.9 km 차이 · 바람·해류 위치도 다름",
     "en": "Requested and returned source locations differ by about 2.9 km; wind and current locations differ"},
]

UNITS = {
    "fractions": "share of the original N=2000 particles (0-1), not probability",
    "cell": "1 km x 1 km cell index (floor(x/1000), floor(y/1000)) east/north of 35.1N 129.3E",
    "times": "ISO 8601 with +09:00 (KST)",
    "frames_xy": "metres east/north of incident (local EQC), integers preserving the 1 km cell",
}


def validate_start(x_m: float, y_m: float, land) -> None:
    """Reject an initial position on known land when a land mask is supplied."""
    if land is not None and land.is_land(x_m, y_m):
        raise LandRejected("REJECTED_LAND: initial position is on known land")


def validate_support(earliest: datetime, eval_end: datetime, support_s: tuple | None, epoch: datetime) -> None:
    """All sampled instants must lie inside the cached forecast time support."""
    if support_s is None:
        raise InputError("no cached time support")
    a = (earliest - epoch).total_seconds()
    b = (eval_end - epoch).total_seconds()
    if a < support_s[0] or b > support_s[1]:
        raise InputError("requested times are outside the cached forecast time support")


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
