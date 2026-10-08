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


def test_headway_is_median_per_line_then_median_across_lines():
    result = stats()["headway"]
    assert result["median_by_line_min"] == 10.0
    assert result["best_min"] == 10.0
    assert {l["id"]: l["median_min"] for l in result["by_line"]} == {"L1:0": 10.0, "L2:0": 10.0}
    assert "overall_median_min" not in result


def test_a_line_counts_once_however_many_stops_it_has():
    # line 0 has 3 stop pairs at 10 min, line 1 has 2 at 60 min: pairs would give 10, lines give 35.
    graph = toy_graph()
    graph.headways.clear()
    graph.headways.update({(0, 0): 10.0, (1, 0): 10.0, (2, 0): 10.0, (3, 1): 60.0, (4, 1): 60.0})
    result = stats(graph)["headway"]
    assert result["median_by_line_min"] == 35.0
    assert result["best_min"] == 10.0


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


def square(west_m, south_m, east_m, north_m):
    """Closed ring in [lat, lon] around a metric box, as boundary.json stores it."""
    ring = [at(west_m, south_m), at(east_m, south_m), at(east_m, north_m), at(west_m, north_m)]
    return [[list(p) for p in [*ring, ring[0]]]]


def test_reach_is_measured_over_stops_inside_the_boundary():
    # C and D lie outside the city; only A and B count, and both are within 30 minutes.
    boundary = {"id": 1, "polygons": [square(-500, -500, 1500, 500)]}
    result = stats(boundary=boundary)["reach"]
    assert result["percent_stops"] == 100.0
    assert result["scope"] == "boundary"


def test_boundary_scope_excludes_unreachable_stops_inside_it():
    # A, B, C inside; only A and B are reached -> 2 of 3.
    boundary = {"id": 1, "polygons": [square(-500, -500, 8500, 500)]}
    assert stats(boundary=boundary)["reach"]["percent_stops"] == 66.7


def test_a_hole_in_the_boundary_excludes_its_stops():
    outer, hole = square(-500, -500, 8500, 500)[0], square(400, -100, 800, 100)[0]
    boundary = {"id": 1, "polygons": [[outer, hole]]}  # B sits in the hole -> A, C inside
    assert stats(boundary=boundary)["reach"]["percent_stops"] == 50.0


def test_without_a_boundary_every_stop_is_served_by_definition():
    # A stop is always within max_access_m of a stop, so the whole stop set is the area.
    for boundary in (None, {"id": None, "polygons": []}):
        result = stats(boundary=boundary)["reach"]
        assert (result["percent_stops"], result["scope"]) == (50.0, "served")


def test_boundary_with_no_stops_inside_is_a_clear_error():
    far = {"id": 1, "polygons": [square(50_000, 50_000, 51_000, 51_000)]}
    with pytest.raises(StatsError, match="boundary"):
        stats(boundary=far)


def test_headway_helpers_return_none_on_empty_input_instead_of_raising():
    from adl.stats import _best, _median

    assert _median([]) is None
    assert _best([]) is None
    assert _median([10.0, 20.0]) == 15.0
    assert _best([20.0, 10.0]) == 10.0
