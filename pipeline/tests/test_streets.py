"""OSM pedestrian ways: Overpass query, filtering and the compact raw cache shape (no network)."""

import pytest

from adl.boundary import BoundaryError
from adl.streets import fetch_streets, unpack_streets, walkable


def way(wid, nodes, coords, **tags):
    tags.setdefault("highway", "residential")
    return {"type": "way", "id": wid, "tags": tags, "nodes": nodes,
            "geometry": [{"lat": lat, "lon": lon} for lat, lon in coords]}


A, B, C = (41.60001, -4.70002), (41.60101, -4.70002), (41.60101, -4.69902)


def canned(*ways):
    def fetcher(query):
        fetcher.queries.append(query)
        return {"elements": list(ways)}

    fetcher.queries = []
    return fetcher


@pytest.mark.parametrize("tags, expected", [
    ({"highway": "residential"}, True),
    ({"highway": "footway"}, True),
    ({"highway": "steps"}, True),
    ({"highway": "cycleway"}, True),
    ({"highway": "cycleway", "foot": "no"}, False),
    ({"highway": "motorway"}, False),
    ({"highway": "trunk"}, False),
    ({"highway": "residential", "foot": "no"}, False),
    ({"highway": "service", "access": "private"}, False),
    ({"highway": "service", "access": "private", "foot": "yes"}, True),
    ({"highway": "service", "service": "parking_aisle"}, False),
    ({"highway": "construction"}, False),
    ({}, False),
])
def test_walkable(tags, expected):
    assert walkable(tags) is expected


def test_fetch_keeps_walkable_ways_and_shares_nodes_between_them():
    ways = [
        way(1, [10, 11], [A, B]),
        way(2, [11, 12], [B, C], highway="footway"),
        way(3, [11, 99], [B, C], highway="motorway"),
        way(4, [12, 98], [C, A], foot="no"),
    ]
    coords, parsed, _ = unpack_streets(fetch_streets([-4.71, 41.59, -4.69, 41.61], canned(*ways)))
    assert len(parsed) == 2 and len(coords) == 3
    shared = set(parsed[0]) & set(parsed[1])
    assert len(shared) == 1 and coords[shared.pop()] == pytest.approx(B)


def test_coordinates_are_rounded_to_five_decimals():
    raw = fetch_streets([-4.71, 41.59, -4.69, 41.61],
                        canned(way(1, [1, 2], [(41.600014, -4.700016), (41.601, -4.7)])))
    coords, _, _ = unpack_streets(raw)
    assert sorted(coords) == pytest.approx([(41.60001, -4.70002), (41.601, -4.7)])


def test_query_asks_for_the_tile_in_south_west_north_east_order_and_excludes_motorways():
    fetcher = canned(way(1, [1, 2], [A, B]))
    fetch_streets([-4.71, 41.59, -4.69, 41.61], fetcher)
    (query,) = fetcher.queries
    assert "(41.59,-4.71,41.61,-4.69)" in query and "out geom" in query
    assert "footway" in query and "motorway" not in query


def test_large_boxes_are_split_into_tiles_and_ways_deduplicated():
    fetcher = canned(way(1, [1, 2], [A, B]))
    raw = fetch_streets([-4.9, 41.5, -4.6, 41.8], fetcher, tile_deg=0.1)
    assert len(fetcher.queries) == 9
    assert len(unpack_streets(raw)[1]) == 1  # the same way came back from every tile


def test_ways_carry_a_road_class():
    ways = [way(1, [1, 2], [A, B], highway="footway"), way(2, [2, 3], [B, C]),
            way(3, [3, 4], [C, A], highway="secondary")]
    assert fetch_streets([-4.71, 41.59, -4.69, 41.61], canned(*ways))["cls"] == [0, 1, 2]


def test_no_walkable_way_is_a_boundary_error():
    with pytest.raises(BoundaryError, match="walkable"):
        fetch_streets([-4.71, 41.59, -4.69, 41.61], canned(way(1, [1, 2], [A, B], highway="motorway")))


def test_raw_shape_is_compact_json_integers():
    raw = fetch_streets([-4.71, 41.59, -4.69, 41.61], canned(way(1, [1, 2], [A, B])))
    assert set(raw) == {"lat", "lon", "ways", "cls"}
    assert all(isinstance(v, int) for v in raw["lat"] + raw["lon"] + raw["ways"][0])
