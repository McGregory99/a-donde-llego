"""City boundary and vector basemap from OpenStreetMap via Overpass.

Network access is isolated in ``overpass_fetch``; every other function takes a
``fetcher(query) -> dict`` so tests inject canned payloads. Polygons are lists
of rings of ``[lat, lon]`` (outer ring first, then holes), rounded to 5 decimals.
"""

from __future__ import annotations

import json
import time
import urllib.parse
import urllib.request
from typing import Callable

from adl.geometry import COORD_DECIMALS, simplify

OVERPASS_URLS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]
USER_AGENT = "a-donde-llego-pipeline (+https://github.com/gcancio/a-donde-llego)"
Fetcher = Callable[[str], dict]
Point = tuple[float, float]


class BoundaryError(Exception):
    """OSM data is missing, unusable or unreachable."""


def _usable(payload) -> bool:
    """Overpass answers HTTP 200 even on timeouts: reject runtime-error remarks and empty results."""
    if not isinstance(payload, dict) or "runtime error" in str(payload.get("remark", "")).lower():
        return False
    return bool(payload.get("elements"))


def overpass_fetch(query: str, *, urls=None, opener=urllib.request.urlopen, sleep=time.sleep,
                   attempts: int = 2, timeout: float = 120) -> dict:
    """POST ``query`` to each Overpass endpoint in turn (``attempts`` rounds)."""
    body = urllib.parse.urlencode({"data": query}).encode()
    for attempt in range(attempts):
        for url in urls or OVERPASS_URLS:
            request = urllib.request.Request(url, data=body, headers={"User-Agent": USER_AGENT})
            try:
                with opener(request, timeout=timeout) as reply:
                    payload = json.loads(reply.read())
            except (OSError, ValueError):
                continue
            if _usable(payload):
                return payload
        if attempt + 1 < attempts:
            sleep(5 * (attempt + 1))
    raise BoundaryError("Overpass unavailable: no endpoint returned a usable answer")


def _points(geometry: list[dict]) -> list[Point]:
    return [(n["lat"], n["lon"]) for n in geometry if n]


def assemble_rings(ways: list[list[Point]]) -> list[list[Point]]:
    """Join open ways end to end into closed rings; rings cut by the query box are dropped."""
    rings, pending = [], [list(w) for w in ways if len(w) >= 2]
    while pending:
        ring = pending.pop()
        while ring[0] != ring[-1]:
            for i, way in enumerate(pending):
                if way[0] == ring[-1]:
                    ring.extend(way[1:])
                elif way[-1] == ring[-1]:
                    ring.extend(reversed(way[:-1]))
                elif way[-1] == ring[0]:
                    ring[:0] = way[:-1]
                elif way[0] == ring[0]:
                    ring[:0] = list(reversed(way[1:]))
                else:
                    continue
                pending.pop(i)
                break
            else:
                break
        if ring[0] == ring[-1] and len(ring) >= 4:
            rings.append(ring)
    return rings


def _inside(point: Point, ring: list[Point]) -> bool:
    y, x, inside = point[0], point[1], False
    for (y1, x1), (y2, x2) in zip(ring, ring[1:]):
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            inside = not inside
    return inside


def _polygons(element: dict, min_distance_m: float) -> list[list[list[list[float]]]]:
    if element["type"] == "way":
        pts = _points(element.get("geometry") or [])
        groups = [[pts]] if len(pts) >= 4 and pts[0] == pts[-1] else []
    else:
        members = [m for m in element.get("members", []) if m["type"] == "way" and m.get("geometry")]
        outers = assemble_rings([_points(m["geometry"]) for m in members if m.get("role") != "inner"])
        inners = assemble_rings([_points(m["geometry"]) for m in members if m.get("role") == "inner"])
        groups = [[o, *[i for i in inners if _inside(i[0], o)]] for o in outers]
    return [
        [[[round(a, COORD_DECIMALS), round(b, COORD_DECIMALS)] for a, b in simplify_ring(r, min_distance_m)]
         for r in group]
        for group in groups
    ]


def simplify_ring(ring: list[Point], min_distance_m: float) -> list[Point]:
    if len(ring) <= 4:
        return list(ring)
    core = simplify(ring[:-1], min_distance_m)
    return [*core, core[0]] if len(core) >= 3 else list(ring)


def fetch_boundary(relation_id: int, fetcher: Fetcher, *, min_distance_m: float = 15.0) -> dict:
    payload = fetcher(f"[out:json][timeout:120];relation({relation_id});out geom;")
    relations = [e for e in payload.get("elements", []) if e.get("type") == "relation"]
    polygons = [p for r in relations for p in _polygons(r, min_distance_m)]
    if not polygons:
        raise BoundaryError(f"OSM relation {relation_id}: no closed boundary ring found")
    return {"id": relation_id, "polygons": polygons}


def fetch_basemap(bbox: list[float], fetcher: Fetcher, *, min_distance_m: float = 15.0) -> dict:
    """Water and parks inside ``bbox`` (w, s, e, n); Overpass wants (s, w, n, e)."""
    w, s, e, n = bbox
    box = f"{s},{w},{n},{e}"
    query = (
        f"[out:json][timeout:180];(nwr[natural=water]({box});nwr[leisure=park]({box}););out geom;"
    )
    out: dict[str, list] = {"water": [], "parks": []}
    for element in fetcher(query).get("elements", []):
        tags = element.get("tags", {})
        target = "water" if tags.get("natural") == "water" else "parks" if tags.get("leisure") == "park" else None
        if target:
            out[target] += _polygons(element, min_distance_m)
    return out
