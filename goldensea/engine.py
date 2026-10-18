"""Golden Sea drift engine.

Pure Python, no dependencies, so the same file runs locally and inside a
Daytona sandbox. Semantics follow contracts/demo-drift-criteria-v1.json
(normative_math). Axes: x = east metres, y = north metres.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

R_EARTH_M = 6_371_000.0
MAX_STEP_S = 600

ACTIVE = "ACTIVE"
UNRELEASED = "UNRELEASED"
DATA_MISSING = "DATA_MISSING"
OUT_OF_DOMAIN = "OUT_OF_DOMAIN"
STRANDED = "STRANDED"
STATES = (ACTIVE, UNRELEASED, DATA_MISSING, OUT_OF_DOMAIN, STRANDED)


# ---------- projection (local spherical EQC) ----------

@dataclass(frozen=True)
class Projection:
    lat0: float
    lon0: float
    lat_ts: float | None = None
    radius_m: float = R_EARTH_M

    @property
    def _cos_ts(self) -> float:
        return math.cos(math.radians(self.lat0 if self.lat_ts is None else self.lat_ts))

    def to_lat_lon(self, x_m: float, y_m: float) -> tuple[float, float]:
        lat = self.lat0 + math.degrees(y_m / self.radius_m)
        lon = self.lon0 + math.degrees(x_m / (self.radius_m * self._cos_ts))
        return lat, lon

    def to_xy(self, lat: float, lon: float) -> tuple[float, float]:
        y = math.radians(lat - self.lat0) * self.radius_m
        x = math.radians(lon - self.lon0) * self.radius_m * self._cos_ts
        return x, y


# ---------- vector conventions ----------

def current_to_uv(speed_km_h: float | None, to_deg: float | None) -> tuple[float, float] | None:
    """Ocean current: direction is where the water flows TO. km/h -> m/s."""
    if speed_km_h is None or to_deg is None:
        return None
    s = speed_km_h / 3.6
    t = math.radians(to_deg)
    return s * math.sin(t), s * math.cos(t)


def wind_from_uv(speed_m_s: float | None, from_deg: float | None) -> tuple[float, float] | None:
    """Meteorological wind: direction is where the wind comes FROM."""
    if speed_m_s is None or from_deg is None:
        return None
    t = math.radians(from_deg)
    return -speed_m_s * math.sin(t), -speed_m_s * math.cos(t)


def total_velocity(current_uv, wind_uv, alpha: float):
    """v = current + alpha * wind. Wind is required only when alpha != 0.

    Returns None when a required input is missing (never invents zero flow).
    """
    if current_uv is None or any(v is None for v in current_uv):
        return None
    if alpha == 0:
        return float(current_uv[0]), float(current_uv[1])
    if wind_uv is None or any(v is None for v in wind_uv):
        return None
    return current_uv[0] + alpha * wind_uv[0], current_uv[1] + alpha * wind_uv[1]


# ---------- forcing: hourly piecewise-constant segments ----------

@dataclass(frozen=True)
class Segment:
    """Left-closed, right-open [start_s, end_s) with constant inputs.

    Times are seconds since a common epoch (UTC). current/wind are (u, v) m/s
    or None when the provider gave no value.
    """
    start_s: float
    end_s: float
    current: tuple[float, float] | None
    wind: tuple[float, float] | None = None


@dataclass
class Forcing:
    segments: list[Segment]

    def segment_at(self, t: float) -> Segment | None:
        for seg in self.segments:
            if seg.start_s <= t < seg.end_s:
                return seg
        return None

    @property
    def support(self) -> tuple[float, float] | None:
        if not self.segments:
            return None
        return self.segments[0].start_s, self.segments[-1].end_s


def constant_forcing(current_uv, start_s: float, end_s: float, wind_uv=None) -> Forcing:
    return Forcing([Segment(start_s, end_s, current_uv, wind_uv)])


# ---------- domain / land ----------

@dataclass(frozen=True)
class Box:
    x0: float
    x1: float
    y0: float
    y1: float

    def contains(self, x: float, y: float) -> bool:
        return self.x0 <= x <= self.x1 and self.y0 <= y <= self.y1


@dataclass
class LandMask:
    """Synthetic land control (rectangles). A real coastline is NOT available."""
    boxes: list[Box] = field(default_factory=list)

    def is_land(self, x: float, y: float) -> bool:
        return any(b.contains(x, y) for b in self.boxes)


# ---------- integration ----------

@dataclass
class Particle:
    x0: float
    y0: float
    release_s: float
    x: float = 0.0
    y: float = 0.0
    state: str = UNRELEASED

    def __post_init__(self):
        self.x, self.y = self.x0, self.y0


def integrate(particles: list[Particle], forcing: Forcing, alpha: float, t_end: float,
              domain: Box | None = None, land: LandMask | None = None,
              max_step_s: float = MAX_STEP_S) -> list[Particle]:
    """Advance each particle from its own release time to t_end.

    Steps never exceed max_step_s and are split at segment boundaries, so
    late releases integrate only the remaining interval. A particle that
    meets missing data stops and becomes DATA_MISSING; one whose step would
    leave the domain stops before leaving and becomes OUT_OF_DOMAIN (no
    clamping, no continued forecast). Without a land mask nothing becomes
    STRANDED.
    """
    for p in particles:
        if p.release_s > t_end:
            p.state = UNRELEASED
            continue
        p.state = ACTIVE
        t = p.release_s
        while t < t_end - 1e-9:
            seg = forcing.segment_at(t)
            if seg is None:
                p.state = DATA_MISSING
                break
            vel = total_velocity(seg.current, seg.wind, alpha)
            if vel is None:
                p.state = DATA_MISSING
                break
            dt = min(max_step_s, seg.end_s - t, t_end - t)
            nx, ny = p.x + vel[0] * dt, p.y + vel[1] * dt
            if domain is not None and not domain.contains(nx, ny):
                p.state = OUT_OF_DOMAIN
                break
            if land is not None and land.boxes and land.is_land(nx, ny):
                p.x, p.y = nx, ny
                p.state = STRANDED
                break
            p.x, p.y = nx, ny
            t += dt
    return particles


def simulate_frames(particles: list[Particle], forcing: Forcing, alpha: float, frame_times: list[float],
                    domain: Box | None = None, max_step_s: float = MAX_STEP_S):
    """Advance once through increasing frame times and snapshot every frame.

    Same rules as integrate(); each particle keeps its own clock so a frame
    never re-integrates from release. Yields (t, [(x, y, state), ...]).
    """
    clock = [p.release_s for p in particles]
    done = [False] * len(particles)
    for t_frame in frame_times:
        for i, p in enumerate(particles):
            if done[i] or p.release_s > t_frame:
                if not done[i]:
                    p.state = UNRELEASED
                continue
            if p.state == UNRELEASED:
                p.state = ACTIVE
            t = clock[i]
            while t < t_frame - 1e-9:
                seg = forcing.segment_at(t)
                vel = None if seg is None else total_velocity(seg.current, seg.wind, alpha)
                if vel is None:
                    p.state = DATA_MISSING; done[i] = True; break
                dt = min(max_step_s, seg.end_s - t, t_frame - t)
                nx, ny = p.x + vel[0] * dt, p.y + vel[1] * dt
                if domain is not None and not domain.contains(nx, ny):
                    p.state = OUT_OF_DOMAIN; done[i] = True; break
                p.x, p.y = nx, ny
                t += dt
            clock[i] = t
        yield t_frame, [(p.x, p.y, p.state) for p in particles]


# ---------- aggregation (fractions over ORIGINAL N) ----------

def bin_counts(particles: list[Particle], cell_m: float = 1000.0, origin=(0.0, 0.0)):
    n = len(particles)
    cells: dict[str, int] = {}
    states = {s: 0 for s in STATES}
    for p in particles:
        states[p.state] += 1
        if p.state == ACTIVE:
            key = f"{math.floor((p.x - origin[0]) / cell_m)},{math.floor((p.y - origin[1]) / cell_m)}"
            cells[key] = cells.get(key, 0) + 1
    fractions = {k: v / n for k, v in cells.items()} if n else {}
    unresolved = n - states[ACTIVE]
    return {
        "n": n,
        "cell_counts": cells,
        "cell_fractions": fractions,
        "state_counts": states,
        "unresolved_count": unresolved,
        "unresolved_fraction": unresolved / n if n else None,
    }
