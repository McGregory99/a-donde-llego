"""Stop graph and schedule-based travel-time model (R3.x). Pure: no I/O, no clock.

Inputs are a parsed GTFS feed (``gtfs_validate.read_feed``) and a loaded city
config; every parameter comes from the city's modes (generic ``kind``: walk or
transit), never from constants in this module.

Model, per transit line (route + direction):
* ride time between consecutive stops = median scheduled time of the trips
  departing inside the reference window on the reference day;
* boarding wait = headway/2 (``factor``) clamped to [min, max], where the
  headway is window length / departures from that stop;
* changing line adds ``transfer_min`` plus the walk to the next stop (within
  ``max_transfer_walk_m``), then that line's boarding wait.
Walking is straight-line distance x ``detour_factor`` at ``speed_m_per_min``.
"""

from __future__ import annotations

import heapq
import math
import statistics
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta

from adl.gtfs_validate import Feed

EARTH_RADIUS_M = 6_371_000.0
MIN_RIDE_MINUTES = 0.4  # guards against zero-length edges from rounded timetables
REFERENCE_WEEKDAYS = (1, 2, 3)  # Tue-Thu
BUSIEST_SHARE = 0.92  # holiday timetables run thinner: only near-busiest days are "plain"
WEEKDAY_COLUMNS = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")


class GraphError(Exception):
    """The feed or city config cannot produce a graph."""


@dataclass
class Graph:
    reference_date: date
    stops: list[dict]
    lines: list[dict]
    waits: dict[tuple[int, int], float]
    rides: dict[tuple[int, int, int], float]
    walk: dict
    modes: dict[str, dict]
    neighbors: dict[int, list[tuple[int, float]]] = field(default_factory=dict)
    headways: dict[tuple[int, int], float] = field(default_factory=dict)  # (stop, line) -> minutes


def wait_minutes(headway_min: float, params: dict) -> float:
    """Boarding wait: ``factor`` x headway, clamped to [min, max]."""
    return min(params["max"], max(params["min"], headway_min * params["factor"]))


def walk_minutes(distance_m: float, params: dict) -> float:
    return distance_m * params["detour_factor"] / params["speed_m_per_min"]


def distance_m(a: tuple[float, float], b: tuple[float, float]) -> float:
    """Great-circle distance between two (lat, lon) points."""
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    dlat, dlon = p2 - p1, math.radians(b[1] - a[1])
    h = math.sin(dlat / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlon / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(h))


def _seconds(value: str) -> int:
    h, m, s = (int(p) for p in value.split(":"))
    return h * 3600 + m * 60 + s


def _clock(value: str) -> int:
    return _seconds(value if value.count(":") == 2 else value + ":00")


def _day(value: str) -> date:
    return datetime.strptime(value, "%Y%m%d").date()


def _services_by_date(feed: Feed) -> dict[date, set[str]]:
    active: dict[date, set[str]] = defaultdict(set)
    for row in feed.get("calendar.txt", []):
        day, end = _day(row["start_date"]), _day(row["end_date"])
        while day <= end:
            if row.get(WEEKDAY_COLUMNS[day.weekday()]) == "1":
                active[day].add(row["service_id"])
            day += timedelta(days=1)
    for row in feed.get("calendar_dates.txt", []):
        day = _day(row["date"])
        if row.get("exception_type") == "1":
            active[day].add(row["service_id"])
        elif row.get("exception_type") == "2":
            active[day].discard(row["service_id"])
    return active


def services_on(feed: Feed, day: date) -> set[str]:
    """Service ids running on ``day`` (calendar rows plus calendar_dates exceptions)."""
    return _services_by_date(feed).get(day, set())


def pick_reference_date(feed: Feed, today: date) -> date:
    """Earliest near-busiest Tue-Thu service day on or after ``today`` (else any)."""
    services = _services_by_date(feed)
    per_service = Counter(t["service_id"] for t in feed["trips.txt"])
    volume = {
        day: sum(per_service[s] for s in active)
        for day, active in services.items()
        if day.weekday() in REFERENCE_WEEKDAYS and active
    }
    volume = {d: v for d, v in volume.items() if v}
    if not volume:
        raise GraphError("feed has no Tue-Thu service day with trips")
    upcoming = {d: v for d, v in volume.items() if d >= today} or volume
    busiest = max(upcoming.values())
    return min(d for d, v in upcoming.items() if v >= BUSIEST_SHARE * busiest)


def _split_modes(city: dict) -> tuple[dict, dict[str, dict]]:
    modes = city["modes"]
    walks = sorted(m for m, p in modes.items() if p["kind"] == "walk")
    if not walks:
        raise GraphError("city config declares no walk mode")
    transit = {m: modes[m] for m in sorted(modes) if modes[m]["kind"] == "transit"}
    return modes[walks[0]], transit


def build_graph(feed: Feed, city: dict, *, today: date, reference_date: date | None = None) -> Graph:
    walk, transit = _split_modes(city)
    mode_of_type = {}
    for mode_id, params in transit.items():
        for route_type in params.get("route_types", []):
            mode_of_type.setdefault(str(route_type), mode_id)
    window = city["window"]
    start, end = _clock(window["start"]), _clock(window["end"])
    if end <= start:
        raise GraphError(f"city window end {window['end']} must be after start {window['start']}")
    window_min = (end - start) / 60.0

    ref = reference_date or pick_reference_date(feed, today)
    active = services_on(feed, ref)
    if not active:
        raise GraphError(f"no service on reference date {ref.isoformat()}")
    route_mode = {
        r["route_id"]: mode_of_type[r["route_type"]]
        for r in feed["routes.txt"]
        if r["route_type"] in mode_of_type
    }
    trips = {
        t["trip_id"]: t
        for t in feed["trips.txt"]
        if t["service_id"] in active and t["route_id"] in route_mode
    }
    by_trip: dict[str, list[dict]] = defaultdict(list)
    for row in feed["stop_times.txt"]:
        if row["trip_id"] in trips:
            by_trip[row["trip_id"]].append(row)

    samples: dict[tuple[str, str, str], list[float]] = defaultdict(list)
    departures: Counter = Counter()
    line_keys: set[tuple[str, str]] = set()
    for trip_id in sorted(by_trip):
        trip = trips[trip_id]
        line = (trip["route_id"], trip.get("direction_id") or "0")
        seq = sorted(by_trip[trip_id], key=lambda r: int(r["stop_sequence"]))
        for a, b in zip(seq, seq[1:]):
            if not a.get("departure_time") or not b.get("arrival_time") or a["stop_id"] == b["stop_id"]:
                continue
            dep = _seconds(a["departure_time"])
            if not start <= dep < end:
                continue
            samples[(*line, a["stop_id"], b["stop_id"])].append(max(0, _seconds(b["arrival_time"]) - dep) / 60.0)
            departures[(line, a["stop_id"])] += 1
            line_keys.add(line)

    stop_rows = {s["stop_id"]: s for s in feed["stops.txt"]}
    used = sorted({k[2] for k in samples} | {k[3] for k in samples})
    stop_index = {sid: i for i, sid in enumerate(used)}
    stops = [
        {"id": sid, "name": stop_rows[sid]["stop_name"],
         "lat": float(stop_rows[sid]["stop_lat"]), "lon": float(stop_rows[sid]["stop_lon"])}
        for sid in used
    ]
    lines = [
        {"id": f"{r}:{d}", "route_id": r, "direction": d, "mode": route_mode[r]}
        for r, d in sorted(line_keys)
    ]
    line_index = {(l["route_id"], l["direction"]): i for i, l in enumerate(lines)}

    rides = {
        (line_index[(r, d)], stop_index[a], stop_index[b]): round(max(MIN_RIDE_MINUTES, statistics.median(v)), 2)
        for (r, d, a, b), v in sorted(samples.items())
    }
    waits = {
        (stop_index[sid], line_index[line]): round(
            wait_minutes(window_min / count, transit[route_mode[line[0]]]["wait"]), 2
        )
        for (line, sid), count in sorted(departures.items())
    }

    headways = {
        (stop_index[sid], line_index[line]): round(window_min / count, 2)
        for (line, sid), count in sorted(departures.items())
    }

    neighbors: dict[int, list[tuple[int, float]]] = {i: [] for i in range(len(stops))}
    reach = walk["max_transfer_walk_m"]
    points = [(s["lat"], s["lon"]) for s in stops]
    for i, p in enumerate(points):
        for j, q in enumerate(points):
            d = distance_m(p, q)
            if i != j and d <= reach:
                neighbors[i].append((j, walk_minutes(d, walk)))
    return Graph(ref, stops, lines, waits, rides, dict(walk), transit, neighbors, headways)


def travel_times(
    graph: Graph,
    origin: tuple[float, float],
    points: list[tuple[float, float]],
    enabled_modes: set[str] | None = None,
) -> list[float | None]:
    """Minimum minutes from ``origin`` to each point (None: unreachable).

    Nodes: ``("S", stop)`` walked-to stop where boarding is possible,
    ``("B", stop, line)`` just boarded (nothing ridden yet) and
    ``("R", stop, line)`` after at least one ride hop. Only ridden nodes can
    egress or transfer, so a stop is never a walking shortcut, and alighting
    never feeds back into a boardable stop: every line change pays
    ``transfer_min`` (R3.4).
    """
    enabled = set(graph.modes) if enabled_modes is None else enabled_modes
    walk, max_access = graph.walk, graph.walk["max_access_m"]
    coords = [(s["lat"], s["lon"]) for s in graph.stops]
    line_on = {i: l["mode"] in enabled for i, l in enumerate(graph.lines)}
    boards: dict[int, list[tuple[int, float]]] = defaultdict(list)
    for (stop, line), wait in graph.waits.items():
        if line_on[line]:
            boards[stop].append((line, wait))
    ride_from: dict[tuple[int, int], list[tuple[int, float]]] = defaultdict(list)
    for (line, a, b), minutes in graph.rides.items():
        if line_on[line]:
            ride_from[(a, line)].append((b, minutes))

    best: dict[tuple, float] = {}
    heap: list[tuple[float, tuple]] = []

    def push(cost: float, node: tuple) -> None:
        if cost < best.get(node, math.inf):
            best[node] = cost
            heapq.heappush(heap, (cost, node))

    for i, c in enumerate(coords):
        d = distance_m(origin, c)
        if d <= max_access:
            push(walk_minutes(d, walk), ("S", i))
    while heap:
        cost, node = heapq.heappop(heap)
        if cost > best[node]:
            continue
        if node[0] == "S":
            for line, wait in boards[node[1]]:
                push(cost + wait, ("B", node[1], line))
            continue
        kind, stop, line = node
        for nxt, minutes in ride_from[(stop, line)]:
            push(cost + minutes, ("R", nxt, line))
        if kind == "B":
            continue
        for target, walk_min in [(stop, 0.0), *graph.neighbors[stop]]:
            for other, wait in boards[target]:
                if other != line:
                    penalty = graph.modes[graph.lines[other]["mode"]]["transfer_min"]
                    push(cost + penalty + walk_min + wait, ("B", target, other))

    egress: dict[int, float] = {}
    for (kind, stop, *_), cost in best.items():
        if kind == "R":
            egress[stop] = min(egress.get(stop, math.inf), cost)

    results: list[float | None] = []
    for p in points:
        options = []
        d = distance_m(origin, p)
        if d <= max_access:
            options.append(walk_minutes(d, walk))
        for stop, cost in egress.items():
            d = distance_m(coords[stop], p)
            if d <= max_access:
                options.append(cost + walk_minutes(d, walk))
        results.append(min(options) if options else None)
    return results
