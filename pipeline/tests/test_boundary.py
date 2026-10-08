"""R2.4/R1.1: city boundary and vector basemap from Overpass (always injected, never networked)."""

import json

import pytest

from adl.boundary import BoundaryError, assemble_rings, fetch_basemap, fetch_boundary, overpass_fetch


def way(*coords):
    return [{"lat": lat, "lon": lon} for lat, lon in coords]


SQUARE_A = way((41.0, -4.0), (41.0, -3.0), (41.1, -3.0))
SQUARE_B = way((41.1, -3.0), (41.1, -4.0), (41.0, -4.0))  # closes the ring with A
HOLE = way((41.03, -3.7), (41.03, -3.5), (41.06, -3.5), (41.03, -3.7))


def relation_payload(members):
    return {"elements": [{"type": "relation", "id": 7, "members": [
        {"type": "way", "role": role, "geometry": geometry} for role, geometry in members]}]}


def test_boundary_joins_open_ways_into_a_ring_with_holes():
    seen = []

    def fetcher(query):
        seen.append(query)
        return relation_payload([("outer", SQUARE_A), ("outer", SQUARE_B), ("inner", HOLE)])

    boundary = fetch_boundary(7, fetcher, min_distance_m=1)
    assert "relation(7)" in seen[0] and "out geom" in seen[0]
    assert boundary["id"] == 7
    (polygon,) = boundary["polygons"]
    assert len(polygon) == 2  # outer + hole
    assert polygon[0][0] == polygon[0][-1]
    assert [41.0, -4.0] in polygon[0]


def test_boundary_with_unclosable_ways_is_an_error():
    with pytest.raises(BoundaryError, match="7"):
        fetch_boundary(7, lambda q: relation_payload([("outer", SQUARE_A)]))


def test_boundary_missing_relation_is_an_error():
    with pytest.raises(BoundaryError, match="7"):
        fetch_boundary(7, lambda q: {"elements": []})


def test_assemble_rings_drops_rings_cut_by_the_query_box():
    pts = lambda *c: [(la, lo) for la, lo in c]
    closed = pts((0, 0), (0, 1), (1, 1), (0, 0))
    open_ = pts((5, 5), (5, 6))
    assert assemble_rings([closed, open_]) == [closed]


def test_basemap_returns_water_and_parks_inside_the_bbox_query():
    seen = []
    ring = way((41.0, -4.0), (41.0, -3.9), (41.1, -3.9), (41.0, -4.0))
    payload = {"elements": [
        {"type": "way", "tags": {"natural": "water"}, "geometry": ring},
        {"type": "way", "tags": {"leisure": "park"}, "geometry": ring},
        {"type": "way", "tags": {"highway": "residential"}, "geometry": ring},
    ]}
    basemap = fetch_basemap([-4.1, 40.9, -3.8, 41.2], lambda q: seen.append(q) or payload, min_distance_m=1)
    assert "40.9,-4.1,41.2,-3.8" in seen[0]  # Overpass bbox order is s,w,n,e
    assert len(basemap["water"]) == 1 and len(basemap["parks"]) == 1


class Reply:
    def __init__(self, payload):
        self.body = json.dumps(payload).encode()

    def read(self):
        return self.body

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


GOOD = {"elements": [{"type": "way", "id": 1}]}


def scripted(*replies):
    """An opener returning/raising the scripted replies in order, recording requested URLs."""
    calls = []

    def opener(request, timeout=None):
        calls.append(request.full_url)
        reply = replies[len(calls) - 1]
        if isinstance(reply, Exception):
            raise reply
        return Reply(reply)

    return opener, calls


def test_overpass_fetch_tries_each_endpoint_until_one_answers():
    opener, calls = scripted(OSError("busy"), GOOD)
    assert overpass_fetch("q", urls=["http://a", "http://b"], opener=opener, sleep=lambda s: None) == GOOD
    assert calls == ["http://a", "http://b"]


def test_overpass_fetch_fails_clearly_when_every_endpoint_is_down():
    def opener(request, timeout=None):
        raise OSError("down")

    with pytest.raises(BoundaryError, match="Overpass"):
        overpass_fetch("q", urls=["http://a"], opener=opener, sleep=lambda s: None)


def test_runtime_error_remark_with_http_200_is_retried_on_the_next_endpoint():
    timed_out = {"elements": [{"type": "way", "id": 1}], "remark": "runtime error: Query timed out"}
    opener, calls = scripted(timed_out, GOOD)
    assert overpass_fetch("q", urls=["http://a", "http://b"], opener=opener, sleep=lambda s: None) == GOOD
    assert calls == ["http://a", "http://b"]


@pytest.mark.parametrize("payload", [{}, {"elements": []}, {"elements": None}])
def test_missing_or_empty_elements_count_as_failure(payload):
    opener, calls = scripted(payload, GOOD)
    assert overpass_fetch("q", urls=["http://a", "http://b"], opener=opener, sleep=lambda s: None) == GOOD
    assert calls == ["http://a", "http://b"]


def test_persistent_runtime_error_ends_in_a_boundary_error():
    opener, _ = scripted({"elements": [], "remark": "runtime error: out of memory"})
    with pytest.raises(BoundaryError, match="Overpass"):
        overpass_fetch("q", urls=["http://a"], opener=opener, sleep=lambda s: None, attempts=1)


def test_retry_rounds_back_off_with_growing_sleeps():
    opener, calls = scripted(OSError("x"), OSError("x"), OSError("x"), GOOD)
    sleeps = []
    result = overpass_fetch("q", urls=["http://a"], opener=opener, sleep=sleeps.append, attempts=4)
    assert result == GOOD
    assert len(calls) == 4
    assert sleeps == [5, 10, 15]


def test_no_sleep_after_the_last_round():
    opener, _ = scripted(OSError("x"), OSError("x"))
    sleeps = []
    with pytest.raises(BoundaryError):
        overpass_fetch("q", urls=["http://a"], opener=opener, sleep=sleeps.append, attempts=2)
    assert sleeps == [5]
