"""Street-based walking in the travel-time model: detours, reach shape, unchanged transit semantics."""

import pytest

from adl.graph import GraphError, build_graph, travel_times
from adl.walkgraph import build_street_graph
from test_graph import HOUR, TODAY, at, idx, make_city, make_feed, six_an_hour
from test_walkgraph import raw_streets

STREETS = {"network": "streets"}


def streets_of(*polylines):
    return build_street_graph(raw_streets(*polylines), spacing_m=20)


def build(stops, trips, streets, network="streets", **foot):
    feed = make_feed(stops, {"L": "3", "M": "3"}, trips)
    city = make_city(HOUR, foot={"network": network, **foot})
    return build_graph(feed, city, today=TODAY, streets=streets)


# West bank street x=0, east bank street x=200, one bridge at y=0 (the only link).
RIVER = [[(0, 1000), (0, 0), (200, 0), (200, 1000)]]
ORIGIN, ACROSS = at(0, 500), at(200, 500)


def test_a_river_with_one_bridge_forces_the_detour():
    far = {"A": at(0, 5000), "B": at(3000, 5000)}
    trips = six_an_hour("L", "A", "B", 5)
    straight = build(far, trips, None, network="straight", max_access_m=1500)
    streets = build(far, trips, streets_of(*RIVER), max_access_m=1500)
    (direct,) = travel_times(straight, ORIGIN, [ACROSS], set())
    (detour,) = travel_times(streets, ORIGIN, [ACROSS], set())
    assert direct == pytest.approx(200 / 75, abs=0.01)
    assert detour == pytest.approx(1200 / 75, abs=0.15)  # 500 m down, 200 m across, 500 m up


def test_the_walking_limit_counts_metres_along_streets():
    far = {"A": at(0, 5000), "B": at(3000, 5000)}
    graph = build(far, six_an_hour("L", "A", "B", 5), streets_of(*RIVER))  # max_access_m 1000 < 1200
    assert travel_times(graph, ORIGIN, [ACROSS, at(0, 900)], set()) == [None, pytest.approx(400 / 75, abs=0.1)]


def test_walk_only_reach_follows_streets_not_a_circle():
    far = {"A": at(0, 5000), "B": at(3000, 5000)}
    avenue = streets_of([(-1500, 0), (0, 0), (1500, 0)], [(0, 0), (0, 300)])
    graph = build(far, six_an_hour("L", "A", "B", 5), avenue)
    points = {"along": at(900, 10), "block": at(0, 250), "off_street": at(0, -600),
              "too_far": at(1200, 0), "straight_close_but_unreachable": at(500, 400)}
    times = dict(zip(points, travel_times(graph, at(0, 0), list(points.values()), set())))
    assert times["along"] == pytest.approx(900 / 75, abs=0.3)
    assert times["block"] == pytest.approx(250 / 75, abs=0.4)  # a node every <= 60 m
    assert times["off_street"] is None and times["straight_close_but_unreachable"] is None
    assert times["too_far"] is None


def test_stops_are_snapped_and_far_ones_are_left_out():
    stops = {"A": at(5, 8), "B": at(900, 1500)}  # B is nowhere near a street
    graph = build(stops, six_an_hour("L", "A", "B", 5), streets_of([(0, 0), (1000, 0)]))
    near, far = (graph.stop_snaps[idx(graph, s)] for s in "AB")
    assert near[1] == pytest.approx(9.4, abs=1.5) and far is None


def test_transfer_neighbours_are_street_walks():
    # C and D are 100 m apart across the river, 1200 m by the bridge
    stops = {"A": at(-3000, 500), "C": at(0, 500), "D": at(100, 500), "B": at(3000, 5000)}
    trips = six_an_hour("L", "A", "C", 5) + six_an_hour("M", "D", "B", 5)
    river = streets_of([(0, 1000), (0, 0), (100, 0), (100, 1000)])
    straight = build(stops, trips, river, network="straight")
    graph = build(stops, trips, river)
    c, d = idx(graph, "C"), idx(graph, "D")
    assert d in {j for j, _ in straight.neighbors[c]}
    assert d not in {j for j, _ in graph.neighbors[c]}


def test_requesting_streets_without_a_street_graph_is_an_error():
    with pytest.raises(GraphError, match="street"):
        build({"A": at(0), "B": at(3000)}, six_an_hour("L", "A", "B", 5), None)


def test_riding_keeps_its_semantics_when_streets_are_straight():
    stops = {"A": at(0), "B": at(3000), "C": at(6000)}
    trips = six_an_hour("L", "A", "B", 6)
    line = streets_of([(-2000, 0), (8000, 0)])
    targets = [at(300), at(3000, 40), at(3400), at(9000), at(4000, 600)]
    straight = build(stops, trips, line, network="straight", max_access_m=1000)
    streets = build(stops, trips, line, max_access_m=1000)
    for origin in (at(60), at(-200)):
        a = travel_times(straight, origin, targets)
        b = travel_times(streets, origin, targets)
        assert [x is None for x in a[:4]] == [x is None for x in b[:4]]
        for x, y in zip(a[:4], b[:4]):
            assert y == pytest.approx(x, abs=0.25) if x is not None else y is None
        assert b[4] is None  # 600 m off the street: no street to walk on


def test_street_walking_ignores_the_detour_factor():
    """Street metres are already the real path: detour_factor only inflates straight-line walks."""
    far = {"A": at(0, 5000), "B": at(3000, 5000)}
    trips = six_an_hour("L", "A", "B", 5)
    avenue = streets_of([(-1500, 0), (0, 0), (1500, 0)])
    plain = build(far, trips, avenue)
    padded = build(far, trips, avenue, detour_factor=1.5)
    target = [at(600, 0)]
    assert travel_times(padded, at(0, 0), target, set()) == travel_times(plain, at(0, 0), target, set())
    assert travel_times(padded, at(0, 0), target, set())[0] == pytest.approx(600 / 75, abs=0.05)
    straight = build(far, trips, None, network="straight", detour_factor=1.5)
    assert travel_times(straight, at(0, 0), target, set())[0] == pytest.approx(600 * 1.5 / 75, abs=0.05)


def test_transfer_neighbour_minutes_are_street_metres_over_speed():
    stops = {"A": at(-3000, 0), "C": at(0, 0), "D": at(300, 0), "B": at(3000, 5000)}
    trips = six_an_hour("L", "A", "C", 5) + six_an_hour("M", "D", "B", 5)
    street = streets_of([(-100, 0), (400, 0)])
    graph = build(stops, trips, street, detour_factor=1.4)
    c, d = idx(graph, "C"), idx(graph, "D")
    ((j, minutes),) = [n for n in graph.neighbors[c] if n[0] == d]
    snap_c, snap_d = graph.stop_snaps[c][1], graph.stop_snaps[d][1]
    along = 300  # C and D snap onto street nodes 300 m apart (nodes every <= 20 m, spaced on the line)
    assert minutes == pytest.approx((snap_c + snap_d + along) / 75, abs=0.1)


def test_streets_walk_exports_the_resolved_snap_distance():
    far = {"A": at(0, 5000), "B": at(3000, 5000)}
    graph = build(far, six_an_hour("L", "A", "B", 5), streets_of([(0, 0), (500, 0)]))
    assert graph.walk["max_snap_m"] == 150.0
    custom = build(far, six_an_hour("L", "A", "B", 5), streets_of([(0, 0), (500, 0)]), max_snap_m=80)
    assert custom.walk["max_snap_m"] == 80
