"""Build CLI: GTFS + OSM -> static JSON assets for one city (R2.1, R2.5, R2.6).

Usage (from the repo root): PYTHONPATH=pipeline uv run python -m adl.build CITY [--out DIR] [--gtfs-file ZIP] [--allow-expired] [--skip-osm]
Writes ``<out>/<city>/{meta,graph,lines,boundary,basemap,stats,walk}.json``.
OSM data (boundary, basemap, streets) comes from the committed cache in cities/osm-cache/<city>/ (see adl.osm_cache);
live Overpass is used only with --refresh-osm / ADL_REFRESH_OSM=1 (falling back to the cache if it is down) or when
the cache cannot serve the city. --skip-osm builds offline without OSM data and is refused for a streets network.
Exit codes: 0 ok, 1 build failure, 2 feed expired.

Output is deterministic: sorted keys, compact separators, no clock reads except
the injected ``now``, which only appears as ``meta.json`` ``built_at``. The city
directory is replaced only after every file is written, so a failed build keeps
the previous output.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import tempfile
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Callable
from urllib.request import urlopen

from adl.boundary import BoundaryError, overpass_fetch
from adl.config import ConfigError, load_city
from adl.fetch import FetchError, fetch_gtfs
from adl.geometry import line_geometry
from adl.graph import Graph, GraphError, build_graph, uses_streets
from adl.gtfs_validate import ExpiredFeedError, Feed, GtfsError, read_feed
from adl.osm_cache import cache_dir, fetch_live, load_cache
from adl.stats import StatsError, compute_stats
from adl.walkgraph import build_street_graph

ASSET_FILES = ("basemap.json", "boundary.json", "graph.json", "lines.json", "meta.json", "stats.json", "walk.json")
SCHEMA_VERSION = 1
DEFAULT_OUT = Path(__file__).resolve().parents[2] / "dist" / "data"


def graph_asset(graph: Graph, feed: Feed) -> dict:
    """Compact stop graph for the browser: tuples become ``[index..., minutes]`` rows."""
    routes = {r["route_id"]: r for r in feed["routes.txt"]}
    lines = [
        {**line, "name": routes[line["route_id"]].get("route_short_name", ""),
         "long_name": routes[line["route_id"]].get("route_long_name", "")}
        for line in graph.lines
    ]
    return {
        "schema": SCHEMA_VERSION,
        "reference_date": graph.reference_date.isoformat(),
        "stops": graph.stops,
        "lines": lines,
        "waits": [[stop, line, m] for (stop, line), m in sorted(graph.waits.items())],
        "rides": [[line, a, b, m] for (line, a, b), m in sorted(graph.rides.items())],
        "neighbors": [[[j, round(m, 2)] for j, m in graph.neighbors.get(i, [])] for i in range(len(graph.stops))],
        "walk": graph.walk,
        "modes": graph.modes,
    }


def build_assets(
    city: dict,
    feed: Feed,
    feed_meta: dict,
    *,
    today: date,
    built_at: datetime,
    boundary: dict,
    basemap: dict,
    streets: dict,
    osm_source: str = "live",
) -> tuple[dict[str, dict], list[str]]:
    """Pure: parsed inputs (``streets`` is the raw shape of ``adl.streets``) -> ({file name: JSON value}, warnings)."""
    street_graph = build_street_graph(streets)
    graph = build_graph(feed, city, today=today, streets=street_graph)
    lines, warnings = line_geometry(feed, graph)
    stats = compute_stats(graph, origins=[tuple(city["center"])], feed_meta=feed_meta,
                           build_date=today, boundary=boundary)
    meta = {
        "schema": SCHEMA_VERSION,
        "city": {"id": city["id"], "name": city["name"]},
        "built_at": built_at.isoformat(),
        "built_on": today.isoformat(),
        "reference_date": graph.reference_date.isoformat(),
        "feed": feed_meta,
        "osm": {"source": osm_source},
    }
    assets = {
        "meta.json": meta,
        "graph.json": graph_asset(graph, feed),
        "lines.json": {"lines": lines, "warnings": warnings},
        "boundary.json": boundary,
        "basemap.json": basemap,
        "stats.json": stats,
        "walk.json": street_graph.to_asset(graph.stop_snaps),
    }
    return assets, warnings


def serialize(value) -> bytes:
    return (json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False) + "\n").encode("utf-8")


def write_assets(assets: dict[str, dict], out_dir: Path) -> None:
    """Write all files to a sibling temp dir, then swap it in for ``out_dir``."""
    out_dir.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(dir=out_dir.parent, prefix=f".{out_dir.name}-"))
    try:
        for name, value in assets.items():
            (staging / name).write_bytes(serialize(value))
        if out_dir.exists():
            # The old build must sit next to out_dir, not inside staging, or the swap would carry it along.
            old = Path(tempfile.mkdtemp(dir=out_dir.parent, prefix=f".{out_dir.name}-old-"))
            old.rmdir()
            out_dir.rename(old)
            staging.rename(out_dir)
            shutil.rmtree(old, ignore_errors=True)
        else:
            staging.rename(out_dir)
    except BaseException:
        shutil.rmtree(staging, ignore_errors=True)
        raise


EMPTY_STREETS = {"lat": [], "lon": [], "ways": [], "cls": []}


def walks_on_streets(city: dict) -> bool:
    return any(uses_streets(m) for m in city["modes"].values() if m["kind"] == "walk")


def refresh_requested(flag: bool) -> bool:
    return flag or os.environ.get("ADL_REFRESH_OSM", "").lower() in {"1", "true", "yes"}


def osm_context(city: dict, fetcher: Callable[[str], dict], skip: bool,
                cities_dir: Path | str | None = None, refresh: bool = False) -> tuple[dict, dict, dict, str]:
    """Boundary, basemap, raw streets and where they came from: the committed cache (default), live
    Overpass (``refresh``, or when the cache cannot serve the city), or skipped."""
    needs_streets = walks_on_streets(city)
    if skip:
        if needs_streets:
            raise BoundaryError("--skip-osm cannot build a city whose walk network is 'streets': "
                                "it has no street graph (use the committed cache or --refresh-osm)")
        return {"id": None, "polygons": []}, {"parks": [], "water": []}, EMPTY_STREETS, "skipped"
    cached = None
    try:
        boundary, basemap, streets = load_cache(city["id"], cities_dir)
        if streets is not None or not needs_streets:
            cached = (boundary, basemap, streets if streets is not None else EMPTY_STREETS, "cache")
        cache_error = None if cached else BoundaryError(
            f"the OSM cache of '{city['id']}' has no streets.json, which a streets walk network needs")
    except BoundaryError as exc:
        cache_error = exc
    if cached and not refresh:
        return cached
    try:
        return (*fetch_live(city, fetcher), "live")
    except BoundaryError as live_error:
        if cached:
            print(f"warning: {live_error}; using the committed OSM cache {cache_dir(city['id'], cities_dir)}",
                  file=sys.stderr)
            return cached
        if cache_error is not None and "streets" in str(cache_error):
            raise BoundaryError(f"{live_error}; {cache_error}") from None
        raise live_error from None


def main(argv=None, *, fetcher=overpass_fetch, opener=urlopen, now: datetime | None = None) -> int:
    parser = argparse.ArgumentParser(prog="adl.build")
    parser.add_argument("city", help="city id (cities/<id>.json)")
    parser.add_argument("--out", default=str(DEFAULT_OUT), help="output root (default <repo>/dist/data)")
    parser.add_argument("--gtfs-file", help="use a local GTFS zip instead of downloading")
    parser.add_argument("--allow-expired", action="store_true", help="dev only: warn on expired feeds")
    parser.add_argument("--skip-osm", action="store_true", help="offline: no boundary, basemap or streets (not for streets cities)")
    parser.add_argument("--refresh-osm", action="store_true",
                        help="fetch OSM data from live Overpass instead of the committed cache (or set ADL_REFRESH_OSM=1)")
    parser.add_argument("--cities-dir")
    parser.add_argument("--today", help="override build date (YYYY-MM-DD)")
    args = parser.parse_args(argv)

    built_at = now or datetime.now(timezone.utc)
    today = date.fromisoformat(args.today) if args.today else built_at.date()
    try:
        city = load_city(args.city, args.cities_dir)
        with tempfile.TemporaryDirectory() as tmp:
            result = fetch_gtfs(city["gtfs"]["sources"], tmp, today, gtfs_file=args.gtfs_file,
                                allow_expired=args.allow_expired, opener=opener)
            feed = read_feed(result.path)
        boundary, basemap, streets, osm_source = osm_context(city, fetcher, args.skip_osm, args.cities_dir, refresh_requested(args.refresh_osm))
        assets, warnings = build_assets(city, feed, result.metadata(), today=today, built_at=built_at,
                                        boundary=boundary, basemap=basemap, streets=streets, osm_source=osm_source)
        write_assets(assets, Path(args.out) / city["id"])
    except ExpiredFeedError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    except (ConfigError, FetchError, GtfsError, GraphError, StatsError, BoundaryError, OSError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    if result.expired:
        print(f"warning: feed expired on {result.valid_to.isoformat()}; "
              "continuing because --allow-expired was given", file=sys.stderr)
    for warning in warnings:
        print(f"warning: {warning}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
