"""Reach statistics when walking follows streets: the share is taken over street nodes, not over stops."""

from datetime import date

import pytest
from test_graph import HOUR, TODAY, at, make_feed, six_an_hour
from test_stats import META, square
from test_street_walking import build, streets_of

from adl.graph import node_times, travel_times
from adl.stats import compute_stats

AVENUE = [(-1500, 0), (1500, 0)]


def street_graph():
    stops = {"A": at(0, 5), "B": at(600, 5), "C": at(8000, 5000), "D": at(9500, 5000)}
    trips = six_an_hour("L", "A", "B", 3) + six_an_hour("M", "C", "D", 3)
    return build(stops, trips, streets_of(AVENUE))


def stats(graph, **kwargs):
    return compute_stats(graph, origins=[at(0)], feed_meta=META, build_date=date(2026, 10, 7), **kwargs)


def test_node_times_equal_the_travel_time_to_a_point_lying_on_each_node():
    graph = street_graph()
    street = graph.streets
    points = list(zip(street.lat, street.lon))
    for enabled in (None, set()):
        expected = travel_times(graph, at(0), points, enabled)
        got = node_times(graph, at(0), enabled)
        assert len(got) == len(street.lat)
        assert [g is None for g in got] == [e is None for e in expected]
        for g, e in zip(got, expected):
            if e is not None:
                assert g == pytest.approx(e, abs=1e-9)


def test_reach_is_the_share_of_street_nodes_within_the_threshold():
    graph = street_graph()
    times = node_times(graph, at(0))
    within = sum(t is not None and t <= 30 for t in times)
    reach = stats(graph)["reach"]
    assert reach["scope"] == "streets"
    assert reach["percent_nodes"] == round(100 * within / len(times), 1)
    assert 0 < reach["percent_nodes"] < 100  # the west end of the avenue is out of reach
    assert reach["percent_stops"] == 50.0  # the stop-based figure stays available


def test_a_boundary_restricts_the_street_nodes_that_count():
    graph = street_graph()
    boundary = {"id": 1, "polygons": [square(-500, -500, 1500, 500)]}  # only x -500..1500 of the avenue, all reached
    reach = stats(graph, boundary=boundary)["reach"]
    assert reach["scope"] == "streets"
    assert reach["percent_nodes"] == 100.0
    whole = stats(graph)["reach"]["percent_nodes"]
    assert reach["percent_nodes"] > whole


def test_straight_walking_keeps_the_stop_based_reach():
    from test_stats import toy_graph

    reach = compute_stats(toy_graph(), origins=[at(0)], feed_meta=META, build_date=date(2026, 10, 7))["reach"]
    assert reach["scope"] == "served" and "percent_nodes" not in reach
