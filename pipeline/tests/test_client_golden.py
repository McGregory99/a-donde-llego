"""R3.8: golden travel times for the browser core, produced by the Python model.

The client (web/src/core) must match ``adl.graph.travel_times`` on the exported
graph asset. This test regenerates the golden file and fails on drift; refresh it
with ``ADL_UPDATE_GOLDEN=1``. ``web/tests/core/parity.test.js`` consumes the file.
"""

import json
import os
from datetime import date
from pathlib import Path

import pytest

from adl.build import graph_asset
from adl.graph import Graph, build_graph, travel_times
from adl.gtfs_validate import Feed
from test_graph import HOUR, at, make_city, make_feed

GOLDEN = Path(__file__).resolve().parents[2] / "web" / "tests" / "golden" / "travel_times.json"
TODAY = date(2026, 10, 7)
ORIGINS = [at(50), at(3000, 150), at(6000, -500), at(-3600, 4100)]  # last one boards the G-E line
FLOAT_TOLERANCE = 1e-9
ENABLED = [None, ["road"], ["rail"], []]


def trips(route: str, stops: list[tuple[str, int]]) -> list:
    """Six departures 08:00-08:50; ``stops`` are (stop, minutes after departure)."""
    out = []
    for i in range(6):
        base = 8 * 60 + i * 10
        seq = [(s, f"{(base + m) // 60:02d}:{(base + m) % 60:02d}") for s, m in stops]
        out.append((f"{route}{i}", route, seq))
    return out


def fixture_feed() -> Feed:
    stops = {
        "A": at(0), "B": at(3000), "C": at(6000), "D": at(3000, 300), "E": at(3000, 3300),
        "F": at(6000, 3000), "G": at(-4000, 4000),
    }
    routes = {"R1": "3", "R2": "3", "R3": "3", "T1": "0"}
    rows = (trips("R1", [("A", 0), ("B", 6), ("C", 11)]) + trips("R2", [("D", 0), ("E", 8)]) + trips("R3", [("G", 0), ("E", 12)])
            + trips("T1", [("C", 0), ("F", 4)]))
    return make_feed(stops, routes, rows)


def graph_from_asset(asset: dict) -> Graph:
    """The exact data the browser sees (minutes already rounded for export)."""
    return Graph(
        reference_date=date.fromisoformat(asset["reference_date"]), stops=asset["stops"],
        lines=asset["lines"], waits={(s, l): m for s, l, m in asset["waits"]},
        rides={(l, a, b): m for l, a, b, m in asset["rides"]}, walk=asset["walk"], modes=asset["modes"],
        neighbors={i: [(j, m) for j, m in row] for i, row in enumerate(asset["neighbors"])},
    )


def build_golden() -> dict:
    feed = fixture_feed()
    asset = graph_asset(build_graph(feed, make_city(HOUR), today=TODAY), feed)
    graph = graph_from_asset(asset)
    points = [at(east, north) for north in range(-1000, 4501, 1000) for east in range(-1500, 7501, 1000)]
    cases = [
        {"origin": list(origin), "enabled": enabled,
         "times": travel_times(graph, origin, points, None if enabled is None else set(enabled))}
        for origin in ORIGINS for enabled in ENABLED
    ]
    return {"graph": asset, "points": [list(p) for p in points], "cases": cases}


def assert_close(actual, expected, path="golden"):
    """Deep equality where floats compare within FLOAT_TOLERANCE (platform libm differences)."""
    if isinstance(expected, float) or isinstance(actual, float):
        assert actual is not None and expected is not None, f"{path}: {actual!r} != {expected!r}"
        assert abs(actual - expected) <= FLOAT_TOLERANCE, f"{path}: {actual!r} != {expected!r}"
    elif isinstance(expected, dict):
        assert actual.keys() == expected.keys(), f"{path}: keys differ"
        for key in expected:
            assert_close(actual[key], expected[key], f"{path}.{key}")
    elif isinstance(expected, list):
        assert len(actual) == len(expected), f"{path}: length {len(actual)} != {len(expected)}"
        for i, (a, e) in enumerate(zip(actual, expected)):
            assert_close(a, e, f"{path}[{i}]")
    else:
        assert actual == expected, f"{path}: {actual!r} != {expected!r}"


def test_assert_close_tolerates_float_noise_but_not_real_drift():
    assert_close({"t": [1.0, None, 2.5]}, {"t": [1.0 + 1e-12, None, 2.5]})
    for drifted in ({"t": [1.0, None, 2.6]}, {"t": [1.0, 3.0, 2.5]}, {"t": [1.0, None]}):
        with pytest.raises(AssertionError):
            assert_close(drifted, {"t": [1.0, None, 2.5]})


def test_golden_travel_times_match_python_model():
    golden = build_golden()
    if os.environ.get("ADL_UPDATE_GOLDEN"):
        GOLDEN.parent.mkdir(parents=True, exist_ok=True)
        GOLDEN.write_text(json.dumps(golden, sort_keys=True, indent=None) + "\n", encoding="utf-8")
    assert_close(json.loads(GOLDEN.read_text(encoding="utf-8")), json.loads(json.dumps(golden)))


def test_golden_covers_transfers_and_unreachable_points():
    cases = build_golden()["cases"]
    reached = [t for c in cases if c["enabled"] is None for t in c["times"] if t is not None]
    assert reached and max(reached) > 20
    assert any(t is None for c in cases for t in c["times"])
    walk_only = next(c for c in cases if c["enabled"] == [] and c["origin"] == list(ORIGINS[0]))
    assert sum(t is not None for t in walk_only["times"]) < sum(t is not None for t in cases[0]["times"])


def test_last_golden_origin_rides_transit_beyond_the_walking_radius():
    golden = build_golden()
    last = next(c for c in golden["cases"] if c["origin"] == list(ORIGINS[3]) and c["enabled"] is None)
    walk_only = next(c for c in golden["cases"] if c["origin"] == list(ORIGINS[3]) and c["enabled"] == [])
    gained = [i for i, (t, w) in enumerate(zip(last["times"], walk_only["times"])) if t is not None and w is None]
    assert len(gained) >= 3
