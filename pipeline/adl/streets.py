"""Pedestrian ways from OpenStreetMap via Overpass, packed into a compact raw cache shape.

Network access stays in the injected ``fetcher(query) -> dict`` (see ``adl.boundary``).
The raw shape keeps full way geometry but renumbers nodes in Hilbert-curve order, so
all numbers are small integers once delta encoded::

    {"lat": [...], "lon": [...],   # 1e-5 degree units, each value the delta to the previous node
     "ways": [[...], ...],         # node indexes, each value the delta to the previous one in the way
     "cls": [...]}                 # road class per way (see ROAD_CLASS)
"""

from __future__ import annotations

import math
from typing import Callable

from adl.boundary import BoundaryError
from adl.geometry import COORD_DECIMALS

Fetcher = Callable[[str], dict]
SCALE = 10**COORD_DECIMALS
TILE_DEG = 0.1  # Overpass answers for a whole city box are huge: ask tile by tile
HIGHWAYS = (
    "footway", "pedestrian", "path", "steps", "living_street", "residential", "service",
    "unclassified", "road", "track", "cycleway", "tertiary", "tertiary_link", "secondary",
    "secondary_link", "primary", "primary_link",
)
ROAD_CLASS = {  # 0 path-like, 1 minor street, 2 main street: lets the client draw main streets thicker
    "footway": 0, "path": 0, "steps": 0, "track": 0, "cycleway": 0,
    "pedestrian": 1, "living_street": 1, "residential": 1, "service": 1, "unclassified": 1, "road": 1,
    "tertiary": 2, "tertiary_link": 2, "secondary": 2, "secondary_link": 2, "primary": 2, "primary_link": 2,
}
NOT_WALKABLE_SERVICES = ("parking_aisle", "driveway", "drive-through")


def walkable(tags: dict) -> bool:
    """Ways a pedestrian may use: no motorways, no ``foot=no``, no private access."""
    if tags.get("highway") not in HIGHWAYS or tags.get("foot") == "no":
        return False
    if tags.get("access") in ("no", "private") and tags.get("foot") not in ("yes", "designated", "permissive"):
        return False
    return tags.get("service") not in NOT_WALKABLE_SERVICES


def _query(s: float, w: float, n: float, e: float) -> str:
    kinds = "|".join(HIGHWAYS)
    return (
        f'[out:json][timeout:180];way[highway~"^({kinds})$"][foot!~"^no$"]'
        f'[access!~"^(private|no)$"][service!~"^(parking_aisle|driveway|drive-through)$"]({s},{w},{n},{e});out geom;'
    )


def _tiles(bbox: list[float], tile_deg: float):
    w, s, e, n = bbox
    cols, rows = math.ceil((e - w) / tile_deg - 1e-9), math.ceil((n - s) / tile_deg - 1e-9)
    for r in range(max(rows, 1)):
        for c in range(max(cols, 1)):
            yield (round(s + r * tile_deg, 6), round(w + c * tile_deg, 6),
                   round(min(n, s + (r + 1) * tile_deg), 6), round(min(e, w + (c + 1) * tile_deg), 6))


def hilbert_key(x: int, y: int, bits: int) -> int:
    """Position of cell (x, y) along the Hilbert curve of a 2^bits square grid."""
    d, s = 0, 1 << (bits - 1) if bits else 0
    while s:
        rx, ry = int(x & s > 0), int(y & s > 0)
        d += s * s * ((3 * rx) ^ ry)
        if ry == 0:
            if rx:
                x, y = s - 1 - x, s - 1 - y
            x, y = y, x
        s >>= 1
    return d


def hilbert_order(cells: list[tuple[int, int]]) -> list[int]:
    """Indexes of ``cells`` sorted along a Hilbert curve (ties by position, so deterministic)."""
    if not cells:
        return []
    x0, y0 = min(c[0] for c in cells), min(c[1] for c in cells)
    bits = max(max(c[0] - x0 for c in cells), max(c[1] - y0 for c in cells), 1).bit_length()
    return sorted(range(len(cells)), key=lambda i: (hilbert_key(cells[i][0] - x0, cells[i][1] - y0, bits), cells[i]))


def deltas(values: list[int]) -> list[int]:
    return [v - p for v, p in zip(values, [0, *values])]


def undelta(values: list[int]) -> list[int]:
    out, acc = [], 0
    for v in values:
        acc += v
        out.append(acc)
    return out


def fetch_streets(bbox: list[float], fetcher: Fetcher, *, tile_deg: float = TILE_DEG) -> dict:
    """Walkable ways inside ``bbox`` (w, s, e, n) as the compact raw shape."""
    coords: dict[int, tuple[int, int]] = {}
    ways: dict[int, list[int]] = {}
    classes: dict[int, int] = {}
    for tile in _tiles(bbox, tile_deg):
        for element in fetcher(_query(*tile)).get("elements", []):
            if element.get("type") != "way" or element["id"] in ways or not walkable(element.get("tags", {})):
                continue
            nodes, geometry = element.get("nodes") or [], element.get("geometry") or []
            if len(nodes) != len(geometry) or len(nodes) < 2:
                continue
            ways[element["id"]] = nodes
            classes[element["id"]] = ROAD_CLASS[element["tags"]["highway"]]
            for node, point in zip(nodes, geometry):
                if point:
                    coords[node] = (round(point["lat"] * SCALE), round(point["lon"] * SCALE))
    ways = {i: w for i, w in ways.items() if all(n in coords for n in w)}
    if not ways:
        raise BoundaryError("OSM streets: no walkable way found in the city box")
    ids = sorted({n for w in ways.values() for n in w})
    order = hilbert_order([coords[n] for n in ids])
    index = {ids[o]: k for k, o in enumerate(order)}
    ordered = [coords[ids[o]] for o in order]
    return {
        "lat": deltas([c[0] for c in ordered]),
        "lon": deltas([c[1] for c in ordered]),
        "ways": [deltas([index[n] for n in ways[i]]) for i in sorted(ways)],
        "cls": [classes[i] for i in sorted(ways)],
    }


def unpack_streets(raw: dict) -> tuple[list[tuple[float, float]], list[list[int]], list[int]]:
    """``(node coordinates as (lat, lon), ways as node-index lists, road class per way)``."""
    coords = [(la / SCALE, lo / SCALE) for la, lo in zip(undelta(raw["lat"]), undelta(raw["lon"]))]
    return coords, [undelta(w) for w in raw["ways"]], raw["cls"]
