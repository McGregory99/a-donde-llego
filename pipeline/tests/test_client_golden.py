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
from adl.walkgraph import StreetGraph, build_street_graph
from test_graph import HOUR, at, make_city, make_feed
from test_walkgraph import raw_streets

GOLDEN = Path(__file__).resolve().parents[2] / "web" / "tests" / "golden" / "travel_times.json"
GOLDEN_STREETS = GOLDEN.with_name("travel_times_streets.json")
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


# ---- streets mode: a river (x 0..300) crossed by one bridge, so walking must detour --------------------
STREETS = [
    [(0, -600), (0, 0), (0, 1000), (0, 3000)],  # west bank
    [(0, 0), (300, 0)],  # the bridge
    [(300, -600), (300, 0), (300, 1500), (300, 3000)],  # east bank
    [(300, 1500), (1500, 1500), (3500, 1500)],  # avenue
    [(3500, 1500), (3500, 1200), (3500, -500)],  # street south of the avenue's end
    [(-1500, 1000), (0, 1000)],  # west avenue
]
STREET_STOPS = {
    "A": at(20, 200), "B": at(3480, 1520), "C": at(310, 2900), "D": at(3490, 1250),
    "E": at(-3000, 4000),  # no street within the snapping distance
    "F": at(1500, 1700),  # 200 m off the avenue: beyond max_snap_m
}
STREET_ORIGINS = [at(10, 300), at(310, 100), at(3400, 1400), at(1500, 800), at(-3000, 4000)]
STREET_ENABLED = [None, ["road"], []]


def street_city():
    city = make_city(HOUR, foot={"network": "streets", "detour_factor": 1.3})
    return city


def street_feed() -> Feed:
    routes = {"R1": "3", "R2": "3", "T1": "0"}
    rows = (trips("R1", [("A", 0), ("B", 9)]) + trips("R2", [("D", 0), ("C", 12)]) + trips("T1", [("E", 0), ("F", 5)]))
    return make_feed(STREET_STOPS, routes, rows)


def graph_from_street_assets(asset: dict, walk: dict) -> Graph:
    """What the browser has: graph.json plus walk.json (stop snaps rounded to whole metres)."""
    graph = graph_from_asset(asset)
    graph.streets = StreetGraph.from_asset(walk)
    graph.stop_snaps = [(n, float(m)) if n >= 0 else None for n, m in zip(walk["stops"]["node"], walk["stops"]["snap_m"])]
    return graph


def build_street_golden() -> dict:
    feed = street_feed()
    streets = build_street_graph(raw_streets(*STREETS), spacing_m=60)
    built = build_graph(feed, street_city(), today=TODAY, streets=streets)
    asset, walk = graph_asset(built, feed), streets.to_asset(built.stop_snaps)
    graph = graph_from_street_assets(asset, walk)
    nodes = [(la, lo) for la, lo in zip(graph.streets.lat, graph.streets.lon)]
    points = [at(e, n) for n in range(-900, 3301, 300) for e in range(-2100, 4201, 300)] + nodes[::7]
    cases = [
        {"origin": list(origin), "enabled": enabled,
         "times": travel_times(graph, origin, points, None if enabled is None else set(enabled))}
        for origin in STREET_ORIGINS for enabled in STREET_ENABLED
    ]
    return {"graph": asset, "walk": walk, "points": [list(p) for p in points], "cases": cases}


def test_golden_street_travel_times_match_python_model():
    golden = build_street_golden()
    if os.environ.get("ADL_UPDATE_GOLDEN"):
        GOLDEN_STREETS.write_text(json.dumps(golden, sort_keys=True, indent=None) + "\n", encoding="utf-8")
    assert_close(json.loads(GOLDEN_STREETS.read_text(encoding="utf-8")), json.loads(json.dumps(golden)))


def test_street_golden_exercises_the_bridge_the_snaps_and_the_walking_limit():
    golden = build_street_golden()
    walk = golden["walk"]
    assert walk["stops"]["node"][4] == -1 and walk["stops"]["node"][5] == -1 and min(walk["stops"]["node"][:4]) >= 0
    assert golden["graph"]["walk"]["network"] == "streets" and golden["graph"]["walk"]["detour_factor"] == 1.3
    assert any(row for row in golden["graph"]["neighbors"])  # B and D are street neighbours
    walk_only = {tuple(c["origin"]): c["times"] for c in golden["cases"] if c["enabled"] == []}
    west, east = walk_only[tuple(STREET_ORIGINS[0])], walk_only[tuple(STREET_ORIGINS[1])]
    assert sum(t is not None for t in west) > 8 and sum(t is not None for t in east) > 8
    assert walk_only[tuple(STREET_ORIGINS[3])].count(None) == len(golden["points"])  # 200 m off every street
    assert walk_only[tuple(STREET_ORIGINS[4])].count(None) == len(golden["points"])
    assert any(t is None for t in west) and any(t is not None for t in west)
    with_transit = next(c for c in golden["cases"] if c["origin"] == list(STREET_ORIGINS[0]) and c["enabled"] is None)
    assert sum(t is not None for t in with_transit["times"]) > sum(t is not None for t in west)
