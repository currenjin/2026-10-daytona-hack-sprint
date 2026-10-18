"""Checks against the frozen contract contracts/demo-drift-criteria-v1.json.

Expected values are read from the frozen file, never from product output.
Run: python3 -m unittest discover -s tests
"""
import hashlib
import json
import math
import unittest
from datetime import datetime, timezone
from pathlib import Path

from goldensea.engine import (ACTIVE, DATA_MISSING, OUT_OF_DOMAIN, STRANDED, Box, LandMask, Particle,
                              Projection, bin_counts, constant_forcing, current_to_uv, integrate,
                              total_velocity, wind_from_uv)
from goldensea.forcing import Forcing, Segment, SetupBlocked, load_entry, provider_time_to_utc
from goldensea.run import load_latent, make_particles, run_scenario
from goldensea.scenarios import (DISCLOSURES, EARLIEST, EVAL_END, InputError, LATEST, LandRejected, validate,
                                 validate_start, validate_support)

ROOT = Path(__file__).resolve().parent.parent
CONTRACTS = ROOT / "contracts"
FROZEN_SHA = "fb35aabb92bdd654ba8231c6cf0047c811e232877ff4299114d57a50311f5ed5"
RAW = (CONTRACTS / "demo-drift-criteria-v1.json").read_bytes()
CASES = {c["id"]: c for c in json.loads(RAW)["cases"]}


def run_const(particles_m, uv, elapsed, alpha=0.0, release=None, domain=None):
    release = release or [0] * len(particles_m)
    ps = [Particle(x, y, r) for (x, y), r in zip(particles_m, release)]
    return integrate(ps, constant_forcing(uv, 0, 10 ** 6), alpha, elapsed, domain=domain)


class Frozen(unittest.TestCase):
    def test_contract_hash(self):
        self.assertEqual(hashlib.sha256(RAW).hexdigest(), FROZEN_SHA)


class Calculation(unittest.TestCase):
    def assertPos(self, ps, expected, tol):
        for p, (ex, ey) in zip(ps, expected):
            self.assertAlmostEqual(p.x, ex, delta=tol)
            self.assertAlmostEqual(p.y, ey, delta=tol)

    def test_C01_C02_C03(self):
        for cid in ("C01", "C02", "C03"):
            c = CASES[cid]
            i, e = c["input"], c["expected"]
            ps = run_const(i["particles_m"], tuple(i["current_uv_m_s"]), i["elapsed_s"], i["alpha"])
            self.assertPos(ps, e["final_positions_m"], c["tolerance"]["position_m"])
            if e.get("initial_particles_unchanged"):
                self.assertEqual([(p.x0, p.y0) for p in ps], [tuple(v) for v in i["particles_m"]])

    def test_C04_current_to(self):
        c = CASES["C04"]
        for deg in c["input"]["current_to_deg"]:
            uv = current_to_uv(c["input"]["speed_km_h"], deg)
            p = run_const([[0, 0]], uv, c["input"]["elapsed_s"])[0]
            ex = c["expected"]["displacement_by_heading_m"][str(deg)]
            self.assertAlmostEqual(p.x, ex[0], delta=1e-6)
            self.assertAlmostEqual(p.y, ex[1], delta=1e-6)

    def test_C05_wind_from(self):
        c = CASES["C05"]
        for v, ex in zip(c["input"]["variants"], c["expected"]["displacements_m"]):
            wuv = wind_from_uv(c["input"]["wind_speed_m_s"], v["wind_from_deg"])
            ps = [Particle(0, 0, 0)]
            integrate(ps, Forcing([Segment(0, 10 ** 6, tuple(c["input"]["current_uv_m_s"]), wuv)]),
                      v["alpha"], c["input"]["elapsed_s"])
            self.assertAlmostEqual(ps[0].x, ex[0], delta=1e-6)
            self.assertAlmostEqual(ps[0].y, ex[1], delta=1e-6)

    def test_C06_partial_release(self):
        c = CASES["C06"]; i = c["input"]
        ps = run_const(i["particles_m"], tuple(i["current_uv_m_s"]), i["evaluate_at_s"], release=i["release_offsets_s"])
        self.assertPos(ps, c["expected"]["final_positions_m"], 1e-6)
        before = run_const([[0, 0]], (1, 0), 900, release=[1800])[0]
        self.assertEqual((before.x, before.y), (0, 0))

    def test_C07_time_varying_and_tz(self):
        c = CASES["C07"]; i = c["input"]
        epoch = datetime.fromisoformat(i["equivalent_start_utc"].replace("Z", "+00:00"))
        self.assertEqual(datetime.fromisoformat(i["start_kst"]), epoch)
        segs = []
        for s in i["segments_utc"]:
            a = (datetime.fromisoformat(s["start"].replace("Z", "+00:00")) - epoch).total_seconds()
            b = (datetime.fromisoformat(s["end"].replace("Z", "+00:00")) - epoch).total_seconds()
            segs.append(Segment(a, b, tuple(s["uv_m_s"])))
        p = integrate([Particle(0, 0, 0)], Forcing(segs), 0.0, 7200)[0]
        self.assertAlmostEqual(p.x, c["expected"]["final_m"][0], delta=1e-6)
        self.assertAlmostEqual(p.y, c["expected"]["final_m"][1], delta=1e-6)
        nv = i["provider_naive_time_variant"]
        self.assertEqual(provider_time_to_utc(nv["local_time"], nv["utc_offset_seconds"]).isoformat().replace("+00:00", "Z"),
                         c["expected"]["provider_naive_time_as_utc"])
        # left-closed right-open: at exactly 04:00 the second segment applies
        self.assertEqual(Forcing(segs).segment_at(3600).current, (0, 1))

    def test_C08_original_denominator(self):
        c = CASES["C08"]; i = c["input"]; e = c["expected"]
        ps = [Particle(x, y, 0) for x, y in i["valid_final_positions_m"]]
        for p in ps:
            p.state = ACTIVE
        miss = Particle(0, 0, 0); miss.state = DATA_MISSING
        agg = bin_counts(ps + [miss], i["grid_cell_m"])
        self.assertEqual(agg["cell_counts"], e["cell_counts"])
        for k, v in e["cell_fractions"].items():
            self.assertAlmostEqual(agg["cell_fractions"][k], v, delta=1e-12)
        self.assertAlmostEqual(agg["unresolved_fraction"], e["unresolved_fraction"], delta=1e-12)
        self.assertAlmostEqual(sum(agg["cell_fractions"].values()) + agg["unresolved_fraction"], 1, delta=1e-12)
        self.assertEqual(agg["n"], e["total_count"])

    def test_C09_missing_not_zero(self):
        c = CASES["C09"]
        got = []
        for v in c["input"]["variants"]:
            cur = tuple(v["current"]); w = v.get("wind")
            got.append("DATA_MISSING" if total_velocity(cur, w, v["alpha"]) is None else "wind_not_required_baseline_allowed")
        self.assertEqual(got, c["expected"]["variants"])
        p = integrate([Particle(0, 0, 0)], constant_forcing((None, 0), 0, 10 ** 6), 0.0, 3600)[0]
        self.assertEqual((p.state, p.x, p.y), (DATA_MISSING, 0, 0))

    def test_C10_domain_exit(self):
        c = CASES["C10"]; i = c["input"]
        (x0, x1), (y0, y1) = i["domain_xy_m"]
        dom = Box(x0, x1, y0, y1)
        mv = run_const(i["particles_m"], tuple(i["current_uv_m_s"]), i["step_s"], domain=dom)
        self.assertEqual(mv[0].state, c["expected"]["moving_case"])
        self.assertTrue(dom.contains(mv[0].x, mv[0].y))  # not continued outside, not clamped to edge
        self.assertEqual((mv[0].x, mv[0].y), (900, 500))
        sf = run_const(i["particles_m"], tuple(i["safe_control_current_uv_m_s"]), i["step_s"], domain=dom)
        self.assertEqual(sf[0].state, c["expected"]["safe_control"])
        self.assertEqual(bin_counts(mv)["unresolved_fraction"], c["expected"]["unknown_fraction_moving"])

    def test_C11_land_controls(self):
        c = CASES["C11"]; i = c["input"]
        (x0, x1), (y0, y1) = i["synthetic_land_rectangle_m"]
        land = LandMask([Box(x0, x1, y0, y1)])
        self.assertTrue(land.is_land(*i["land_input_m"]))
        self.assertFalse(land.is_land(*i["sea_control_m"]))
        with self.assertRaises(LandRejected):
            validate_start(*i["land_input_m"], land)
        validate_start(*i["sea_control_m"], land)
        validate_start(*i["land_input_m"], None)   # no mask: not rejected, coastline unverified
        # the real integration path rejects too, before advancing anything
        with self.assertRaises(LandRejected):
            integrate([Particle(*i["land_input_m"], 0)], constant_forcing((1, 0), 0, 10 ** 6), 0.0, 600, land=land)
        sea = integrate([Particle(*i["sea_control_m"], 0)], constant_forcing((0, 0), 0, 10 ** 6), 0.0, 600, land=land)[0]
        self.assertNotEqual(sea.state, STRANDED)
        # without a mask nothing becomes STRANDED
        p = run_const([[0, 0]], (1, 0), 3600)[0]
        self.assertNotEqual(p.state, STRANDED)

    def test_C13_shared_latent_and_repeatability(self):
        c = CASES["C13"]
        self.assertEqual(hashlib.sha256((CONTRACTS / c["input"]["latent_particles"]).read_bytes()).hexdigest(),
                         c["input"]["latent_sha256"])
        latent = load_latent(CONTRACTS)
        a = make_particles(latent, 250, LATEST); b = make_particles(latent, 1000, LATEST)
        for pa, pb in zip(a[:50], b[:50]):
            self.assertAlmostEqual(pa.x0 * 4, pb.x0, delta=1e-9)
            self.assertEqual(pa.release_s, pb.release_s)

    def test_C16_projection(self):
        c = CASES["C16"]; i = c["input"]
        pr = Projection(i["origin_lat_lon"][0], i["origin_lat_lon"][1], i["eqc_lat_ts_deg"], i["sphere_R_m"])
        for (dx, dy), (elat, elon) in zip(i["offsets_east_north_m"], c["expected"]["lat_lon_by_offset"]):
            lat, lon = pr.to_lat_lon(dx, dy)
            self.assertAlmostEqual(lat, elat, delta=1e-6)
            self.assertAlmostEqual(lon, elon, delta=1e-6)


class Frames(unittest.TestCase):
    def test_frames_match_direct_integration(self):
        from goldensea.engine import simulate_frames
        fc = Forcing([Segment(0, 3600, (1, 0)), Segment(3600, 7200, (0, 1)), Segment(7200, 10800, (None, 0))])
        rel = [0, 900, 5000, 9000]
        frames = list(simulate_frames([Particle(0, 0, r) for r in rel], fc, 0.0, [1800, 3600, 7200, 9600]))
        for t, snap in frames:
            direct = integrate([Particle(0, 0, r) for r in rel], fc, 0.0, t)
            for (x, y, st), d in zip(snap, direct):
                self.assertAlmostEqual(x, d.x, delta=1e-9); self.assertAlmostEqual(y, d.y, delta=1e-9)
                self.assertEqual(st, d.state)


    def test_cell_round_keeps_cell(self):
        from goldensea.run import cell_round
        for v in (999.6, -0.4, -1000.4, 1999.5, 1234.4, -999.5, 0.0):
            self.assertEqual(math.floor(cell_round(v) / 1000), math.floor(v / 1000))
            self.assertLessEqual(abs(cell_round(v) - v), 1.0)


class InputValidation(unittest.TestCase):
    def test_C15_outside_cached_time_support(self):
        from datetime import timedelta
        epoch = EARLIEST
        support = (0.0, 6 * 3600.0)
        validate_support(EARLIEST, EVAL_END, support, epoch)
        with self.assertRaises(InputError):
            validate_support(EARLIEST + timedelta(days=30), EVAL_END + timedelta(days=30), support, epoch)
        with self.assertRaises(InputError):
            validate_support(EARLIEST, EVAL_END, None, epoch)

    def test_C14_disclosures_in_export(self):
        res = run_scenario("S0", ROOT / "tests" / "no-such-cache", CONTRACTS)
        self.assertEqual(len(res["disclosures"]), 9)
        self.assertEqual(len(DISCLOSURES), 9)
        self.assertIn("units", res)

    def test_C15_input_errors(self):
        bad = [
            dict(lat=math.nan, lon=129.3, radius_m=250, alpha=0.0),
            dict(lat=35.1, lon=129.3, radius_m=-1, alpha=0.0),
            dict(lat=35.1, lon=129.3, radius_m=1001, alpha=0.0),
            dict(lat=35.1, lon=129.3, radius_m=250, alpha=0.5),
            dict(lat=36.0, lon=129.3, radius_m=250, alpha=0.0),
        ]
        for b in bad:
            with self.assertRaises(InputError):
                validate(b["lat"], b["lon"], b["radius_m"], EARLIEST, LATEST, EVAL_END, b["alpha"])
        with self.assertRaises(InputError):
            validate(35.1, 129.3, 250, LATEST, EARLIEST, EVAL_END, 0.0)

    def test_C12_C15_cache_missing_is_setup_blocked(self):
        res = run_scenario("S0", ROOT / "tests" / "no-such-cache", CONTRACTS)
        self.assertEqual(res["status"], "SETUP_BLOCKED")
        self.assertIsNone(res["stranding_fraction"])
        self.assertIn("COASTLINE_UNVERIFIED", res["quality_flags"])

    def test_C12_hash_mismatch_blocks(self):
        tmp = ROOT / "tests" / "_tmp_cache"
        tmp.mkdir(exist_ok=True)
        (tmp / "openmeteo_marine.json").write_text("[]")
        try:
            entry = json.loads((CONTRACTS / "cache-manifest.json").read_text())["entries"][0]
            with self.assertRaises(SetupBlocked):
                load_entry(tmp, entry)
        finally:
            (tmp / "openmeteo_marine.json").unlink()
            tmp.rmdir()


if __name__ == "__main__":
    unittest.main()
