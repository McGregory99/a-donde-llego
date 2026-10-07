"""Build-time aggregates (R8.1, R8.3, R8.4), computed with the map's own model.

Reach: share of stops whose ``travel_times`` from an origin is within the
threshold, averaged over the origin set. The share is never taken over the city
bbox (mostly countryside, which would dilute it). Its area is the set of stops
inside the city boundary when one is given ("boundary" scope), otherwise every
stop ("served" scope: each stop is within ``max_access_m`` of a stop, itself,
and nothing else defines the served area without a boundary). Headway: median of window length /
departures per (stop, line), per line and overall. Pure; no clock.
"""

from __future__ import annotations

import statistics
from collections import defaultdict
from datetime import date

from adl.boundary import contains
from adl.graph import Graph, travel_times

DEFAULT_THRESHOLD_MIN = 30


class StatsError(Exception):
    """The network cannot support the requested aggregates."""


def _median(values: list[float]) -> float:
    return round(statistics.median(values), 1)


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
    by_line: dict[int, list[float]] = defaultdict(list)
    for (_, line), headway in graph.headways.items():
        by_line[line].append(headway)
    every = [h for hs in by_line.values() for h in hs]
    return {
        "reference_date": graph.reference_date.isoformat(),
        "built_on": build_date.isoformat(),
        "feed": dict(feed_meta),
        "stops": len(graph.stops),
        "lines": len(graph.lines),
        "reach": {
            "threshold_min": threshold_min,
            "origins": len(origins),
            "scope": "boundary" if polygons else "served",
            "percent_stops": round(sum(shares) / len(shares), 1),
        },
        "headway": {
            "overall_median_min": _median(every),
            "by_line": [
                {"id": graph.lines[i]["id"], "median_min": _median(hs)} for i, hs in sorted(by_line.items())
            ],
        },
    }
