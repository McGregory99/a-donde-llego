"""Line geometry for the map (R2.4). Pure: OSM-derived shapes are passed in.

Per graph line (route + direction) the most used trip shape wins: ``shapes.txt``
first, then caller-supplied OSM polylines, then straight stop-to-stop segments
(with a warning). Points are ``[lat, lon]`` rounded to 5 decimals.
"""

from __future__ import annotations

from collections import Counter, defaultdict

from adl.graph import Graph, distance_m

COORD_DECIMALS = 5


def simplify(points: list[tuple[float, float]], min_distance_m: float) -> list[tuple[float, float]]:
    """Drop points closer than ``min_distance_m`` to the last kept one; keep both ends."""
    if len(points) <= 2:
        return list(points)
    kept = [points[0]]
    for p in points[1:-1]:
        if distance_m(kept[-1], p) >= min_distance_m:
            kept.append(p)
    kept.append(points[-1])
    return kept


def _rounded(points) -> list[list[float]]:
    return [[round(lat, COORD_DECIMALS), round(lon, COORD_DECIMALS)] for lat, lon in points]


def _most_common(counter: Counter):
    return min(counter, key=lambda k: (-counter[k], k))


def line_geometry(
    feed: dict,
    graph: Graph,
    *,
    osm_shapes: dict[str, list[tuple[float, float]]] | None = None,
    min_distance_m: float = 15.0,
) -> tuple[list[dict], list[str]]:
    """Return (``[{id, mode, source, points}]`` in graph line order, warnings)."""
    osm_shapes = osm_shapes or {}
    shape_points: dict[str, list[tuple[int, tuple[float, float]]]] = defaultdict(list)
    for row in feed.get("shapes.txt", []):
        shape_points[row["shape_id"]].append(
            (int(row["shape_pt_sequence"]), (float(row["shape_pt_lat"]), float(row["shape_pt_lon"])))
        )
    stop_rows = {s["stop_id"]: (float(s["stop_lat"]), float(s["stop_lon"])) for s in feed["stops.txt"]}
    seq_by_trip: dict[str, list[tuple[int, str]]] = defaultdict(list)
    for row in feed["stop_times.txt"]:
        seq_by_trip[row["trip_id"]].append((int(row["stop_sequence"]), row["stop_id"]))

    shapes_of: dict[tuple[str, str], Counter] = defaultdict(Counter)
    stops_of: dict[tuple[str, str], Counter] = defaultdict(Counter)
    for trip in feed["trips.txt"]:
        key = (trip["route_id"], trip.get("direction_id") or "0")
        if trip.get("shape_id") in shape_points:
            shapes_of[key][trip["shape_id"]] += 1
        if trip["trip_id"] in seq_by_trip:
            stops_of[key][tuple(s for _, s in sorted(seq_by_trip[trip["trip_id"]]))] += 1

    out, warnings = [], []
    for line in graph.lines:
        key = (line["route_id"], line["direction"])
        if shapes_of[key]:
            source = "shapes"
            points = [p for _, p in sorted(shape_points[_most_common(shapes_of[key])])]
        elif osm_shapes.get(line["route_id"]):
            source, points = "osm", list(osm_shapes[line["route_id"]])
        elif stops_of[key]:
            source = "stops"
            points = [stop_rows[s] for s in _most_common(stops_of[key])]
            warnings.append(f"line {line['id']}: no shapes.txt or OSM geometry, using straight stop segments")
        else:
            warnings.append(f"line {line['id']}: no geometry available")
            continue
        out.append({"id": line["id"], "mode": line["mode"], "source": source,
                    "points": _rounded(simplify(points, min_distance_m))})
    return out, warnings
