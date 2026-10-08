"""Build-time aggregates (R8.1, R8.3, R8.4), computed with the map's own model.

Reach: share of stops whose ``travel_times`` from an origin is within the
threshold, averaged over the origin set. Headway: median of window length /
departures per (stop, line), per line and overall. Pure; no clock.
"""

from __future__ import annotations

import statistics
from collections import defaultdict
from datetime import date

from adl.graph import Graph, travel_times

DEFAULT_THRESHOLD_MIN = 30


def _median(values: list[float]) -> float:
    return round(statistics.median(values), 1)


def compute_stats(
    graph: Graph,
    *,
    origins: list[tuple[float, float]],
    feed_meta: dict,
    build_date: date,
    threshold_min: float = DEFAULT_THRESHOLD_MIN,
) -> dict:
    coords = [(s["lat"], s["lon"]) for s in graph.stops]
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
            "percent_stops": round(sum(shares) / len(shares), 1),
        },
        "headway": {
            "overall_median_min": _median(every),
            "by_line": [
                {"id": graph.lines[i]["id"], "median_min": _median(hs)} for i, hs in sorted(by_line.items())
            ],
        },
    }
