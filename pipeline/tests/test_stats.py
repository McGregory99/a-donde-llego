"""R8.1, R8.3, R8.4: build-time aggregates from the same graph/model as the map."""

from datetime import date

import pytest
from test_graph import HOUR, TODAY, at, make_city, make_feed, six_an_hour

from adl.graph import build_graph, travel_times
from adl.stats import StatsError, compute_stats

META = {"valid_from": "2026-10-07", "valid_to": "2026-12-27", "expired": False}


def toy_graph():
    # A, B within walking range of the origin; C, D too far from it and from any ride it can take.
    stops = {"A": at(0), "B": at(600), "C": at(8000), "D": at(9500)}
    trips = six_an_hour("L1", "A", "B", 3) + six_an_hour("L2", "C", "D", 3)
    return build_graph(make_feed(stops, {"L1": "3", "L2": "3"}, trips), make_city(HOUR), today=TODAY)


def stats(graph=None, **kwargs):
    kwargs.setdefault("origins", [at(0)])
    return compute_stats(graph or toy_graph(), feed_meta=META, build_date=date(2026, 10, 7), **kwargs)


def test_two_of_four_stops_within_30_minutes_is_50_percent():
    assert stats()["reach"]["percent_stops"] == 50.0
    assert stats()["reach"]["threshold_min"] == 30


def test_reach_uses_the_same_model_as_the_map():
    graph = toy_graph()
    coords = [(s["lat"], s["lon"]) for s in graph.stops]
    times = travel_times(graph, at(0), coords)
    within = sum(t is not None and t <= 30 for t in times)
    assert stats(graph)["reach"]["percent_stops"] == 100 * within / len(coords)


def test_threshold_and_multiple_origins_average():
    result = compute_stats(toy_graph(), origins=[at(0), at(8000)], feed_meta=META,
                           build_date=date(2026, 10, 7), threshold_min=30)
    assert result["reach"]["origins"] == 2
    assert result["reach"]["percent_stops"] == 50.0  # 50% from each origin


def test_headway_is_median_per_line_and_overall():
    result = stats()["headway"]
    assert result["overall_median_min"] == 10.0
    assert {l["id"]: l["median_min"] for l in result["by_line"]} == {"L1:0": 10.0, "L2:0": 10.0}


def test_counts_and_feed_validity_and_build_date_are_recorded():
    result = stats()
    assert (result["stops"], result["lines"]) == (4, 2)
    assert result["feed"] == META
    assert result["built_on"] == "2026-10-07"
    assert result["reference_date"] == "2026-10-07"


def test_stats_are_deterministic():
    assert stats() == stats()


def test_empty_origin_set_is_a_clear_error():
    with pytest.raises(StatsError, match="origin"):
        stats(origins=[])


def test_network_without_headways_is_a_clear_error():
    graph = toy_graph()
    graph.headways.clear()
    with pytest.raises(StatsError, match="headway"):
        stats(graph)


def test_network_without_stops_is_a_clear_error():
    graph = toy_graph()
    graph.stops.clear()
    with pytest.raises(StatsError, match="stops"):
        stats(graph)
