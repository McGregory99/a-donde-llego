"""Build-time aggregates (R8.1, R8.3, R8.4), computed with the map's own model.

Reach: share of stops whose ``travel_times`` from an origin is within the
threshold, averaged over the origin set. The share is never taken over the city
bbox (mostly countryside, which would dilute it). Its area is the set of stops
inside the city boundary when one is given ("boundary" scope), otherwise every
stop ("served" scope: each stop is within ``max_access_m`` of a stop, itself,
and nothing else defines the served area without a boundary).
When walking follows streets ("streets" scope) the map paints street segments, so the headline share
(``percent_nodes``) is taken over street nodes (inside the boundary when there is one) whose
``node_times`` is within the threshold; ``percent_stops`` stays as the stop-based figure. Headway: window length /
departures per (stop, line); each line takes the median over its stops, then the headline is the median
across lines (a line counts once, however many stops it has) and the best (smallest) line. Pure; no clock.
"""

from __future__ import annotations

import statistics
from collections import defaultdict
from datetime import date

from adl.boundary import contains
from adl.graph import Graph, node_times, travel_times, uses_streets

DEFAULT_THRESHOLD_MIN = 30


class StatsError(Exception):
    """The network cannot support the requested aggregates."""


def _median(values: list[float]) -> float | None:
    """Median rounded to 0.1, or None when there is nothing to measure."""
    return round(statistics.median(values), 1) if values else None


def _best(values: list[float]) -> float | None:
    """Smallest value, or None when there is nothing to measure."""
    return min(values) if values else None


def _street_share(graph: Graph, origins: list[tuple[float, float]], threshold_min: float, polygons: list) -> float:
    """Percent of street nodes (inside ``polygons`` when given) within the threshold, averaged over origins."""
    street = graph.streets
    nodes = range(len(street.lat))
    if polygons:
        nodes = [n for n in nodes if contains(polygons, (street.lat[n], street.lon[n]))]
        if not nodes:
            raise StatsError("boundary contains none of the street nodes: check the boundary relation")
    shares = []
    for origin in origins:
        times = node_times(graph, origin)
        shares.append(100 * sum(times[n] is not None and times[n] <= threshold_min for n in nodes) / len(nodes))
    return round(sum(shares) / len(shares), 1)


def compute_stats(
    graph: Graph,
    *,
    origins: list[tuple[float, float]],
    feed_meta: dict,
    build_date: date,
    threshold_min: float = DEFAULT_THRESHOLD_MIN,
    boundary: dict | None = None,
) -> dict:
    if not origins:
        raise StatsError("no origins given: reach needs at least one origin")
    if not graph.stops:
        raise StatsError("graph has no stops: nothing to measure")
    if not graph.headways:
        raise StatsError("graph has no headways: no line departs inside the window")
    polygons = (boundary or {}).get("polygons") or []
    coords = [(s["lat"], s["lon"]) for s in graph.stops]
    if polygons:
        coords = [c for c in coords if contains(polygons, c)]
        if not coords:
            raise StatsError("boundary contains none of the stops: check the boundary relation")
    shares = []
    for origin in origins:
        times = travel_times(graph, origin, coords)
        shares.append(100 * sum(t is not None and t <= threshold_min for t in times) / len(coords))
    node_share = _street_share(graph, origins, threshold_min, polygons) if uses_streets(graph.walk) and graph.streets and graph.streets.lat else None
    by_line: dict[int, list[float]] = defaultdict(list)
    for (_, line), headway in graph.headways.items():
        by_line[line].append(headway)
    line_medians = {i: _median(hs) for i, hs in by_line.items()}
    return {
        "reference_date": graph.reference_date.isoformat(),
        "built_on": build_date.isoformat(),
        "feed": dict(feed_meta),
        "stops": len(graph.stops),
        "lines": len(graph.lines),
        "reach": {
            "threshold_min": threshold_min,
            "origins": len(origins),
            "scope": "streets" if node_share is not None else "boundary" if polygons else "served",
            "percent_stops": round(sum(shares) / len(shares), 1),
            **({"percent_nodes": node_share} if node_share is not None else {}),
        },
        "headway": {
            "median_by_line_min": _median(list(line_medians.values())),
            "best_min": _best(list(line_medians.values())),
            "by_line": [{"id": graph.lines[i]["id"], "median_min": m} for i, m in sorted(line_medians.items())],
        },
    }
