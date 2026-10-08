"""Compact pedestrian street graph: simplified from raw OSM ways, encoded for the browser.

``build_street_graph`` contracts the degree-2 nodes of the raw ways into edges that keep
their shape: junctions, dead ends and road-class changes stay nodes, long chains keep a node
every ``spacing_m`` (so a point can be snapped close to the street), and the points between
two nodes survive as a polyline simplified to ``SIMPLIFY_M``. Everything outside the largest
connected component is dropped; coordinates are quantised to 1e-5 degrees and edge lengths to
whole metres. The asset (``walk.json``) holds integers only, nodes in Hilbert order and every
undirected edge once, grouped by its lower node and oriented from it::

    {"schema": 1, "scale": 100000, "n": N,
     "lat": [...], "lon": [...],    # nodes, delta encoded, 1/scale degrees
     "deg": [...],                  # per node: edges to a higher-numbered node
     "to": [...],                   # per edge: neighbour index minus node index
     "m": [...],                    # per edge: length in metres
     "cls": [...],                  # per edge: road class 0 path, 1 minor street, 2 main street
     "geo": [...],                  # per edge: number of intermediate shape points
     "glat": [...], "glon": [...],  # those points, each a delta to the previous one (the first
                                    # to the edge's lower node), 1/scale degrees
     "stops": {"node": [...], "snap_m": [...]}}   # per graph stop (node -1: no street nearby)
"""

from __future__ import annotations

import heapq
import math
from collections import defaultdict

from adl.geometry import COORD_DECIMALS
from adl.graph import distance_m
from adl.streets import SCALE, deltas, hilbert_order, undelta, unpack_streets

SCHEMA_VERSION = 1
NODE_SPACING_M = 60  # chains of degree-2 nodes keep a node about this often
SIMPLIFY_M = 2.5  # tolerance for the shape points kept inside an edge
_CELL_DEG = 0.001  # snapping grid: about 111 m

Point = tuple[float, float]
Edge = tuple[int, list[Point]]  # (road class, shape points from the lower node to the higher one)


class StreetGraph:
    """Undirected street network. ``adj[node]`` lists ``(neighbour, metres)``; ``shapes[(a, b)]``
    (a < b) holds the road class and the intermediate shape points of that edge, oriented a to b."""

    def __init__(self, lat: list[float], lon: list[float], adj: list[list[tuple[int, int]]],
                 shapes: dict[tuple[int, int], Edge] | None = None):
        self.lat, self.lon, self.adj = lat, lon, adj
        self.shapes = shapes if shapes is not None else {
            (a, b): (1, []) for a, row in enumerate(adj) for b, _ in row if a < b}
        self._cells: dict[tuple[int, int], list[int]] | None = None

    @classmethod
    def from_asset(cls, asset: dict) -> "StreetGraph":
        scale = asset["scale"]
        lat = [v / scale for v in undelta(asset["lat"])]
        lon = [v / scale for v in undelta(asset["lon"])]
        adj: list[list[tuple[int, int]]] = [[] for _ in lat]
        shapes: dict[tuple[int, int], Edge] = {}
        edge = point = 0
        for a, count in enumerate(asset["deg"]):
            for _ in range(count):
                b, metres = a + asset["to"][edge], asset["m"][edge]
                adj[a].append((b, metres))
                adj[b].append((a, metres))
                n = asset["geo"][edge]
                la, lo = round(lat[a] * scale), round(lon[a] * scale)
                pts = []
                for k in range(point, point + n):
                    la, lo = la + asset["glat"][k], lo + asset["glon"][k]
                    pts.append((la / scale, lo / scale))
                shapes[(a, b)] = (asset["cls"][edge], pts)
                point += n
                edge += 1
        return cls(lat, lon, [sorted(row) for row in adj], shapes)

    def to_asset(self, stop_snaps: list[tuple[int, float] | None] | None = None) -> dict:
        deg, to, metres, classes, geo, glat, glon = [], [], [], [], [], [], []
        for a, row in enumerate(self.adj):
            higher = [(b, m) for b, m in row if b > a]
            deg.append(len(higher))
            for b, m in higher:
                road_class, pts = self.shapes[(a, b)]
                to.append(b - a)
                metres.append(m)
                classes.append(road_class)
                geo.append(len(pts))
                la, lo = round(self.lat[a] * SCALE), round(self.lon[a] * SCALE)
                for p_lat, p_lon in pts:
                    ila, ilo = round(p_lat * SCALE), round(p_lon * SCALE)
                    glat.append(ila - la)
                    glon.append(ilo - lo)
                    la, lo = ila, ilo
        asset = {
            "schema": SCHEMA_VERSION, "scale": SCALE, "n": len(self.lat),
            "lat": deltas([round(v * SCALE) for v in self.lat]),
            "lon": deltas([round(v * SCALE) for v in self.lon]),
            "deg": deg, "to": to, "m": metres, "cls": classes, "geo": geo, "glat": glat, "glon": glon,
        }
        if stop_snaps is not None:
            asset["stops"] = {
                "node": [s[0] if s else -1 for s in stop_snaps],
                "snap_m": [round(s[1]) if s else 0 for s in stop_snaps],
            }
        return asset

    def _index(self) -> dict[tuple[int, int], list[int]]:
        if self._cells is None:
            cells: dict[tuple[int, int], list[int]] = defaultdict(list)
            for i, (la, lo) in enumerate(zip(self.lat, self.lon)):
                cells[self._cell(la, lo)].append(i)
            self._cells = cells
            self._cell_m = 111_320 * _CELL_DEG
        return self._cells

    def _cell(self, lat: float, lon: float) -> tuple[int, int]:
        return math.floor(lat / _CELL_DEG), math.floor(lon * math.cos(math.radians(lat)) / _CELL_DEG)

    def nearest(self, point: Point, max_m: float) -> tuple[int, float] | None:
        """Closest node within ``max_m`` straight-line metres of ``point``, as ``(node, metres)``."""
        cells = self._index()
        ci, cj = self._cell(*point)
        best: tuple[float, int] | None = None
        for ring in range(math.ceil(max_m / self._cell_m) + 2):
            for i in range(ci - ring, ci + ring + 1):
                for j in range(cj - ring, cj + ring + 1):
                    if max(abs(i - ci), abs(j - cj)) != ring:
                        continue
                    for node in cells.get((i, j), ()):
                        d = distance_m(point, (self.lat[node], self.lon[node]))
                        if d <= max_m and (best is None or (d, node) < best):
                            best = (d, node)
            if best is not None and best[0] <= ring * self._cell_m:
                break
        return (best[1], best[0]) if best else None

    def reach(self, source: int, limit_m: float) -> dict[int, float]:
        """Shortest street metres from ``source`` to every node within ``limit_m``."""
        dist = {source: 0.0}
        heap = [(0.0, source)]
        while heap:
            d, node = heapq.heappop(heap)
            if d > dist[node]:
                continue
            for nxt, metres in self.adj[node]:
                nd = d + metres
                if nd <= limit_m and nd < dist.get(nxt, math.inf):
                    dist[nxt] = nd
                    heapq.heappush(heap, (nd, nxt))
        return dist


def _largest_component(adj: list[dict[int, float]]) -> list[int]:
    seen, best = set(), []
    for start in range(len(adj)):
        if start in seen or not adj[start]:
            continue
        component, stack = [], [start]
        seen.add(start)
        while stack:
            node = stack.pop()
            component.append(node)
            for nxt in adj[node]:
                if nxt not in seen:
                    seen.add(nxt)
                    stack.append(nxt)
        if len(component) > len(best):
            best = component
    return sorted(best)


def simplify_shape(points: list[Point], tolerance_m: float) -> list[Point]:
    """Douglas-Peucker on the intermediate ``points`` of an edge; the end points are fixed by the caller."""
    if len(points) <= 2:
        return points
    lat0 = points[0][0]
    kx, ky = 111_320 * math.cos(math.radians(lat0)), 111_320
    xy = [(p[1] * kx, p[0] * ky) for p in points]
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        i, j = stack.pop()
        (x1, y1), (x2, y2) = xy[i], xy[j]
        dx, dy = x2 - x1, y2 - y1
        norm = math.hypot(dx, dy)
        far, far_d = -1, tolerance_m
        for k in range(i + 1, j):
            x, y = xy[k]
            d = abs(dy * (x - x1) - dx * (y - y1)) / norm if norm else math.hypot(x - x1, y - y1)
            if d > far_d:
                far, far_d = k, d
        if far >= 0:
            keep[far] = True
            stack += [(i, far), (far, j)]
    return [p for p, k in zip(points, keep) if k]


def build_street_graph(raw: dict, *, spacing_m: float | None = NODE_SPACING_M,
                       simplify_m: float = SIMPLIFY_M) -> StreetGraph:
    coords, ways, way_class = unpack_streets(raw)
    adj: list[dict[int, float]] = [{} for _ in coords]
    road: dict[tuple[int, int], int] = {}

    def link(a: int, b: int, d: float, c: int) -> None:
        adj[a][b] = adj[b][a] = d
        road[(a, b)] = road[(b, a)] = c

    def split(a: int, b: int, d: float, c: int) -> None:
        """A long OSM segment gets interpolated nodes, so any street point has a node nearby."""
        parts = math.ceil(d / spacing_m)
        (la, lo), (lb, lp), prev = coords[a], coords[b], a
        for k in range(1, parts):
            coords.append((round(la + (lb - la) * k / parts, COORD_DECIMALS),
                           round(lo + (lp - lo) * k / parts, COORD_DECIMALS)))
            adj.append({})
            link(prev, len(coords) - 1, d / parts, c)
            prev = len(coords) - 1
        link(prev, b, d / parts, c)

    seen: set[tuple[int, int]] = set()
    for way, c in zip(ways, way_class):
        for a, b in zip(way, way[1:]):
            if a == b or (min(a, b), max(a, b)) in seen:
                continue
            seen.add((min(a, b), max(a, b)))
            d = distance_m(coords[a], coords[b])
            split(a, b, d, c) if spacing_m and d > spacing_m else link(a, b, d, c)
    component = _largest_component(adj)
    junctions = {v for v in component
                 if len(adj[v]) != 2 or len({road[(v, n)] for n in adj[v]}) > 1} or set(component[:1])
    kept, used = set(junctions), set()
    edges: dict[tuple[int, int], tuple[float, int, list[Point]]] = {}
    for start in sorted(junctions):
        for first in sorted(adj[start]):
            if (start, first) in used:
                continue
            c = road[(start, first)]
            prev, cur, last, acc, shape = start, first, start, adj[start][first], []
            used |= {(start, first), (first, start)}
            while cur not in junctions:
                nxt = next(n for n in adj[cur] if n != prev)
                if spacing_m is not None and acc + adj[cur][nxt] > spacing_m:
                    kept.add(cur)
                    _add_edge(edges, last, cur, acc, c, shape)
                    last, acc, shape = cur, 0.0, []
                else:
                    shape.append(coords[cur])
                used |= {(cur, nxt), (nxt, cur)}
                acc += adj[cur][nxt]
                prev, cur = cur, nxt
            _add_edge(edges, last, cur, acc, c, shape)
    cells = {v: (round(coords[v][0] * SCALE), round(coords[v][1] * SCALE)) for v in sorted(kept)}
    ids = sorted(cells)
    order = [ids[i] for i in hilbert_order([cells[v] for v in ids])]
    index = {v: i for i, v in enumerate(order)}
    rows: list[list[tuple[int, int]]] = [[] for _ in order]
    shapes: dict[tuple[int, int], Edge] = {}
    for (a, b), (metres, c, shape) in edges.items():
        ia, ib = index[a], index[b]
        rounded = max(1, round(metres))
        rows[ia].append((ib, rounded))
        rows[ib].append((ia, rounded))
        inner = [p for p in simplify_shape([coords[a], *shape, coords[b]], simplify_m)[1:-1]]
        inner = [(round(la, COORD_DECIMALS), round(lo, COORD_DECIMALS)) for la, lo in inner]
        shapes[(ia, ib)] = (c, inner) if ia < ib else (c, inner[::-1])
        if ia > ib:
            shapes[(ib, ia)] = shapes.pop((ia, ib))
    return StreetGraph([coords[v][0] for v in order], [coords[v][1] for v in order],
                       [sorted(r) for r in rows], shapes)


def _add_edge(edges, a: int, b: int, metres: float, c: int, shape: list[Point]) -> None:
    if a == b:
        return
    if a > b:
        a, b, shape = b, a, shape[::-1]
    if metres < edges.get((a, b), (math.inf,))[0]:
        edges[(a, b)] = (metres, c, shape)
