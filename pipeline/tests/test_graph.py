"""R3.1-R3.8: stop graph and the pure travel-time query, on tiny synthetic feeds."""

import math
from datetime import date

import pytest

from adl.graph import GraphError, build_graph, travel_times
from adl.gtfs_validate import read_feed

TODAY = date(2026, 10, 7)  # a Wednesday
LAT0, LON0 = 41.6, -4.7
M_PER_DEG_LON = 111_320 * math.cos(math.radians(LAT0))


def at(east_m: float, north_m: float = 0.0) -> tuple[float, float]:
    return (LAT0 + north_m / 111_320, LON0 + east_m / M_PER_DEG_LON)


def make_city(window=("07:00", "20:00"), **overrides) -> dict:
    city = {
        "window": {"start": window[0], "end": window[1]},
        "modes": {
            "foot": {"kind": "walk", "speed_m_per_min": 75, "detour_factor": 1.0,
                     "max_access_m": 1000, "max_transfer_walk_m": 400},
            "road": {"kind": "transit", "route_types": [3],
                     "wait": {"factor": 0.5, "min": 1, "max": 15}, "transfer_min": 1.5},
            "rail": {"kind": "transit", "route_types": [0],
                     "wait": {"factor": 1.0, "min": 1, "max": 15}, "transfer_min": 3.0},
        },
    }
    for mode, params in overrides.items():
        city["modes"][mode].update(params)
    return city


def make_feed(stops: dict[str, tuple[float, float]], routes: dict[str, str], trips: list) -> dict:
    """trips: (trip_id, route_id, [(stop_id, "HH:MM[:SS]"), ...]); weekday service all year."""

    def t(value):
        return value if value.count(":") == 2 else value + ":00"

    return {
        "stops.txt": [
            {"stop_id": s, "stop_name": s, "stop_lat": str(lat), "stop_lon": str(lon)}
            for s, (lat, lon) in stops.items()
        ],
        "routes.txt": [{"route_id": r, "route_type": rt} for r, rt in routes.items()],
        "trips.txt": [
            {"route_id": r, "service_id": "WK", "trip_id": tid, "direction_id": "0"}
            for tid, r, _ in trips
        ],
        "stop_times.txt": [
            {"trip_id": tid, "stop_id": s, "arrival_time": t(hhmm), "departure_time": t(hhmm),
             "stop_sequence": str(n)}
            for tid, _, seq in trips
            for n, (s, hhmm) in enumerate(seq, 1)
        ],
        "calendar.txt": [
            {"service_id": "WK", "monday": "1", "tuesday": "1", "wednesday": "1", "thursday": "1",
             "friday": "1", "saturday": "0", "sunday": "0",
             "start_date": "20260101", "end_date": "20271231"}
        ],
    }


def six_an_hour(route, a, b, ride_min):
    """Six trips between 08:00 and 08:50: headway 10 min in a 08:00-09:00 window."""
    out = []
    for i in range(6):
        dep = 8 * 60 + i * 10
        arr = dep + ride_min
        out.append((f"{route}{i}", route, [(a, f"{dep // 60:02d}:{dep % 60:02d}"), (b, f"{arr // 60:02d}:{arr % 60:02d}")]))
    return out


HOUR = ("08:00", "09:00")


def idx(graph, stop_id):
    return next(i for i, s in enumerate(graph.stops) if s["id"] == stop_id)


def test_median_ride_time_inside_window_only():
    stops = {"A": at(0), "B": at(3000)}
    trips = [
        ("t1", "L", [("A", "08:00"), ("B", "08:05")]),
        ("t2", "L", [("A", "09:00"), ("B", "09:07")]),
        ("t3", "L", [("A", "10:00"), ("B", "10:09")]),
        ("t4", "L", [("A", "21:00"), ("B", "21:40")]),  # outside 07:00-20:00
    ]
    graph = build_graph(make_feed(stops, {"L": "3"}, trips), make_city(), today=TODAY)
    ((_, a, b), minutes), = graph.rides.items()
    assert (graph.stops[a]["id"], graph.stops[b]["id"]) == ("A", "B")
    assert minutes == 7.0


def test_other_window_keeps_only_its_trips():
    stops = {"A": at(0), "B": at(3000)}
    trips = [
        ("t1", "L", [("A", "08:00"), ("B", "08:05")]),
        ("t4", "L", [("A", "21:00"), ("B", "21:40")]),
    ]
    graph = build_graph(make_feed(stops, {"L": "3"}, trips), make_city(("20:00", "23:00")), today=TODAY)
    assert list(graph.rides.values()) == [40.0]


def test_wait_comes_from_headway_in_window_and_mode_params():
    stops = {"A": at(0), "B": at(3000)}
    routes = {"R": "3", "T": "0"}
    trips = six_an_hour("R", "A", "B", 6) + six_an_hour("T", "A", "B", 6)
    graph = build_graph(make_feed(stops, routes, trips), make_city(HOUR), today=TODAY)
    waits = {graph.lines[line]["route_id"]: w for (_, line), w in graph.waits.items()}
    assert waits == {"R": 5.0, "T": 10.0}  # factor 0.5 vs factor 1.0 on headway 10


def test_reference_day_skips_weekends_and_past_dates():
    stops = {"A": at(0), "B": at(3000)}
    feed = make_feed(stops, {"L": "3"}, six_an_hour("L", "A", "B", 5))
    graph = build_graph(feed, make_city(HOUR), today=date(2026, 10, 10))  # Saturday
    assert graph.reference_date == date(2026, 10, 13)  # next Tuesday


def test_no_service_day_is_an_error():
    feed = make_feed({"A": at(0), "B": at(100)}, {"L": "3"}, six_an_hour("L", "A", "B", 5))
    feed["calendar.txt"][0].update(tuesday="0", wednesday="0", thursday="0")
    with pytest.raises(GraphError, match="service day"):
        build_graph(feed, make_city(HOUR), today=TODAY)


def one_line(ride=6, dist=900):
    stops = {"A": at(0), "B": at(dist)}
    return make_feed(stops, {"L": "3"}, six_an_hour("L", "A", "B", ride))


def test_single_ride_is_wait_plus_ride():
    graph = build_graph(one_line(), make_city(HOUR), today=TODAY)
    (t,) = travel_times(graph, at(0), [at(900)])
    # walking 900 m takes 12 min, the ride 11: the ride wins
    assert t == pytest.approx(11, abs=0.05)


def test_walk_only_wins_when_faster():
    graph = build_graph(one_line(ride=30), make_city(HOUR), today=TODAY)
    (t,) = travel_times(graph, at(0), [at(900)])
    assert t == pytest.approx(12, abs=0.05)


def test_access_and_egress_walks_are_added():
    graph = build_graph(one_line(ride=6, dist=3000), make_city(HOUR), today=TODAY)
    (t,) = travel_times(graph, at(0, 150), [at(3000, 150)])
    assert t == pytest.approx(2 + 5 + 6 + 2, abs=0.1)


def test_transfer_adds_penalty_walk_and_second_wait():
    stops = {"A": at(0), "B": at(3000), "B2": at(3100), "C": at(6000)}
    trips = six_an_hour("L1", "A", "B", 6) + six_an_hour("L2", "B2", "C", 8)
    graph = build_graph(make_feed(stops, {"L1": "3", "L2": "3"}, trips), make_city(HOUR), today=TODAY)
    (t,) = travel_times(graph, at(0), [at(6000)])
    assert t == pytest.approx(5 + 6 + 1.5 + 100 / 75 + 5 + 8, abs=0.1)


def test_no_free_transfer_by_alighting_and_reboarding():
    stops = {"A": at(0), "B": at(3000), "C": at(6000)}
    trips = six_an_hour("L1", "A", "B", 6) + six_an_hour("L2", "B", "C", 8)
    graph = build_graph(make_feed(stops, {"L1": "3", "L2": "3"}, trips), make_city(HOUR), today=TODAY)
    (t,) = travel_times(graph, at(0), [at(6000)])
    assert t == pytest.approx(5 + 6 + 1.5 + 5 + 8, abs=0.1)


def test_unreachable_beyond_walking_radius():
    graph = build_graph(one_line(dist=3000), make_city(HOUR), today=TODAY)
    assert travel_times(graph, at(0), [at(1500, 4000), at(0, 1500)]) == [None, None]


def test_walk_radius_is_per_mode_configuration():
    city = make_city(HOUR, foot={"max_access_m": 2000})
    graph = build_graph(one_line(dist=3000), city, today=TODAY)
    (t,) = travel_times(graph, at(0), [at(1500)])
    assert t == pytest.approx(20, abs=0.1)


def test_disabled_transit_mode_leaves_walking_only():
    graph = build_graph(one_line(ride=2, dist=900), make_city(HOUR), today=TODAY)
    (t,) = travel_times(graph, at(0), [at(900)], enabled_modes=set())
    assert t == pytest.approx(12, abs=0.05)
    (t,) = travel_times(graph, at(0), [at(900)], enabled_modes={"road"})
    assert t == pytest.approx(7, abs=0.05)


def test_unconfigured_route_types_are_ignored():
    feed = make_feed({"A": at(0), "B": at(900)}, {"L": "2"}, six_an_hour("L", "A", "B", 3))
    graph = build_graph(feed, make_city(HOUR), today=TODAY)
    assert graph.lines == [] and graph.rides == {}


def test_city_without_walk_mode_is_an_error():
    city = make_city(HOUR)
    del city["modes"]["foot"]
    with pytest.raises(GraphError, match="walk"):
        build_graph(one_line(), city, today=TODAY)


def test_build_is_deterministic():
    a = build_graph(one_line(), make_city(HOUR), today=TODAY)
    b = build_graph(one_line(), make_city(HOUR), today=TODAY)
    assert a == b


def test_mini_gtfs_fixture_builds(make_zip):
    graph = build_graph(read_feed(make_zip("mini_gtfs")), make_city(), today=TODAY)
    assert [s["id"] for s in graph.stops] == ["S1", "S2", "S3", "S4"]
    assert len(graph.lines) == 3 and len(graph.rides) == 3


def test_stop_is_not_a_walking_shortcut_without_riding():
    # A is 900 m from the origin; P is 900 m past A. Walking through A (board, no
    # ride, egress) must not extend the walking limit.
    stops = {"A": at(900), "B": at(5000)}
    graph = build_graph(make_feed(stops, {"L": "3"}, six_an_hour("L", "A", "B", 6)), make_city(HOUR), today=TODAY)
    (t,) = travel_times(graph, at(0), [at(1800)])
    assert t is None


def test_transfer_without_riding_is_not_a_walking_shortcut():
    # Ride L1 to B, walk to C (<= 400 m transfer) without riding L2, then egress at C.
    stops = {"A": at(0), "B": at(3000), "C": at(3300), "D": at(9000)}
    trips = six_an_hour("L1", "A", "B", 6) + six_an_hour("L2", "C", "D", 6)
    graph = build_graph(make_feed(stops, {"L1": "3", "L2": "3"}, trips), make_city(HOUR), today=TODAY)
    (t,) = travel_times(graph, at(0), [at(4200)])  # 1200 m from B, 900 m from C
    assert t is None
