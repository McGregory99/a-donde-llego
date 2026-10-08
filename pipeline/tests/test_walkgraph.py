"""Compact pedestrian graph: contraction, components, asset codec, snapping (pure, no network)."""

import math

import pytest

from adl.graph import distance_m
from adl.streets import fetch_streets
from adl.walkgraph import StreetGraph, build_street_graph

LAT0, LON0 = 41.6, -4.7
M_LAT = 111_320
M_LON = 111_320 * math.cos(math.radians(LAT0))


def at(east_m, north_m=0.0):
    return (LAT0 + north_m / M_LAT, LON0 + east_m / M_LON)


def raw_streets(*polylines):
    """Raw cache shape from polylines of (east_m, north_m); equal points share an OSM node."""
    ids, elements = {}, []
    for k, line in enumerate(polylines, 1):
        nodes = [ids.setdefault(p, len(ids) + 1) for p in line]
        elements.append({"type": "way", "id": k, "tags": {"highway": "residential"}, "nodes": nodes,
                         "geometry": [dict(zip(("lat", "lon"), at(*p))) for p in line]})
    return fetch_streets([-4.71, 41.59, -4.69, 41.61], lambda q: {"elements": elements})


def edges(graph):
    return sorted((a, b, m) for a, row in enumerate(graph.adj) for b, m in row if a < b)


def test_degree_two_nodes_are_contracted_and_lengths_summed():
    # a 400 m street with 4 interior nodes, crossed by a side street at its middle
    main = [(x, 0) for x in range(0, 401, 100)]
    graph = build_street_graph(raw_streets(main, [(200, 0), (200, 150)]), spacing_m=None)
    assert len(graph.lat) == 4  # two ends, the crossing and the side street end
    lengths = sorted(m for _, _, m in edges(graph))
    assert lengths == pytest.approx([150, 200, 200], abs=3)


def test_long_chains_keep_nodes_at_most_spacing_apart():
    graph = build_street_graph(raw_streets([(x, 0) for x in range(0, 1001, 50)]), spacing_m=120)
    assert 8 <= len(graph.lat) <= 12
    assert max(m for _, _, m in edges(graph)) <= 120 + 3


def test_a_long_two_vertex_segment_is_subdivided():
    graph = build_street_graph(raw_streets([(0, 0), (1000, 0)]), spacing_m=100)
    assert len(graph.lat) >= 11 and max(m for _, _, m in edges(graph)) <= 100 + 3
    assert sum(m for _, _, m in edges(graph)) == pytest.approx(1000, abs=12)


def test_only_the_largest_connected_component_is_kept():
    graph = build_street_graph(raw_streets([(0, 0), (100, 0), (200, 0)], [(0, 500), (60, 500)]), spacing_m=None)
    assert len(graph.lat) == 2 and edges(graph)[0][2] == pytest.approx(200, abs=3)


def test_crossing_ways_without_a_shared_node_do_not_connect():
    graph = build_street_graph(raw_streets([(-100, 0), (100, 0)], [(0, -100), (0, 100)]), spacing_m=None)
    assert len(edges(graph)) == 1  # the larger-by-nodes line; the other is a separate component


def test_parallel_edges_keep_the_shortest_and_loops_vanish():
    around = [(0, 0), (100, 0), (100, 100), (0, 100), (0, 0)]
    graph = build_street_graph(raw_streets(around, [(0, 0), (100, 0)]), spacing_m=None)
    assert all(a != b for a, b, _ in edges(graph))
    assert len(edges(graph)) == len({(a, b) for a, b, _ in edges(graph)})


def test_asset_round_trip_is_lossless_and_compact_integers():
    graph = build_street_graph(raw_streets([(x, 0) for x in range(0, 501, 50)], [(250, 0), (250, 200)]))
    asset = graph.to_asset()
    assert set(asset) == {"schema", "scale", "n", "lat", "lon", "deg", "to", "m", "cls", "geo", "glat", "glon"}
    assert asset["n"] == len(graph.lat) == len(asset["lat"]) == len(asset["deg"])
    assert all(isinstance(v, int) for key in ("lat", "lon", "deg", "to", "m", "cls", "geo", "glat", "glon") for v in asset[key])
    back = StreetGraph.from_asset(asset)
    assert (back.lat, back.lon, back.adj, back.shapes) == (graph.lat, graph.lon, graph.adj, graph.shapes)


def test_asset_records_the_snap_of_each_stop():
    graph = build_street_graph(raw_streets([(0, 0), (100, 0)]), spacing_m=None)
    asset = graph.to_asset([(1, 12.4), None])
    assert asset["stops"] == {"node": [1, -1], "snap_m": [12, 0]}


def test_nearest_respects_the_snap_limit_and_reach_the_walking_limit():
    graph = build_street_graph(raw_streets([(x, 0) for x in range(0, 501, 100)]), spacing_m=110)
    node, snap = graph.nearest(at(103, 30), 150)
    assert snap == pytest.approx(31, abs=3) and graph.nearest(at(103, 400), 150) is None
    reach = graph.reach(node, 250)
    assert sorted(round(d) for d in reach.values()) == [0, 100, 100, 200]


def test_build_is_deterministic():
    raw = raw_streets([(x, 0) for x in range(0, 501, 50)], [(250, 0), (250, 200)])
    assert build_street_graph(raw).to_asset() == build_street_graph(raw).to_asset()


def test_edges_keep_their_shape_simplified_and_oriented_from_the_lower_node():
    bend = [(0, 0), (100, 3), (200, 0), (300, 0), (300, 200)]  # the 3 m bump and the corner survive, the flat point goes
    graph = build_street_graph(raw_streets(bend), spacing_m=None, simplify_m=2.5)
    ((a, b), (road_class, pts)), = graph.shapes.items()
    assert a < b and road_class == 1 and len(pts) == 2
    start = (graph.lat[a], graph.lon[a])
    assert distance_m(start, pts[0]) < distance_m(start, pts[1])  # listed from the lower node outwards
    assert sorted(distance_m(at(0, 0), p) for p in [start, *pts]) == pytest.approx([0, 100, 300], abs=2)


def test_a_road_class_change_splits_the_edge():
    raw = raw_streets([(0, 0), (100, 0)], [(100, 0), (200, 0)])
    raw["cls"] = [0, 2]
    graph = build_street_graph(raw, spacing_m=None)
    assert sorted(c for c, _ in graph.shapes.values()) == [0, 2]
    assert len(graph.lat) == 3
