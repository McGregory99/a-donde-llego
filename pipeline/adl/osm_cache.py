"""Committed fallback for the OSM context (boundary, basemap and pedestrian streets) of a city.

Overpass is often down, so the build falls back to ``<cities dir>/osm-cache/<city>/{boundary,basemap}.json``
(same shapes as the build output). Refresh it from live Overpass, then commit it:

    PYTHONPATH=pipeline uv run --locked python -m adl.osm_cache CITY [--cities-dir DIR]
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Callable

from adl.boundary import BoundaryError, fetch_basemap, fetch_boundary, overpass_fetch
from adl.config import CITIES_DIR, ConfigError, load_city
from adl.streets import fetch_streets

CACHE_DIRNAME = "osm-cache"
FILES = ("boundary.json", "basemap.json", "streets.json")


def cache_dir(city_id: str, cities_dir: Path | str | None = None) -> Path:
    return Path(cities_dir if cities_dir is not None else CITIES_DIR) / CACHE_DIRNAME / city_id


def fetch_live(city: dict, fetcher: Callable[[str], dict]) -> tuple[dict, dict, dict]:
    relation = city.get("boundary", {}).get("osm_relation_id")
    boundary = fetch_boundary(relation, fetcher) if relation else {"id": None, "polygons": []}
    return boundary, fetch_basemap(city["bbox"], fetcher), fetch_streets(city["bbox"], fetcher)


def save_cache(city_id: str, boundary: dict, basemap: dict, streets: dict,
               cities_dir: Path | str | None = None) -> Path:
    target = cache_dir(city_id, cities_dir)
    target.mkdir(parents=True, exist_ok=True)
    for name, value in zip(FILES, (boundary, basemap, streets)):
        text = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False) + "\n"
        (target / name).write_text(text, encoding="utf-8")
    return target


def load_cache(city_id: str, cities_dir: Path | str | None = None) -> tuple[dict, dict, dict]:
    target = cache_dir(city_id, cities_dir)
    loaded = []
    for name in FILES:
        path = target / name
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            raise BoundaryError(f"no OSM cache for '{city_id}' ({path} is missing)") from None
        except (OSError, ValueError) as exc:
            raise BoundaryError(f"unreadable OSM cache file {path.name}: {exc}") from exc
        if not isinstance(value, dict):
            raise BoundaryError(f"unreadable OSM cache file {path.name}: not a JSON object")
        loaded.append(value)
    return loaded[0], loaded[1], loaded[2]


def main(argv=None, *, fetcher=overpass_fetch) -> int:
    parser = argparse.ArgumentParser(prog="adl.osm_cache", description="Refresh the committed OSM cache from live Overpass.")
    parser.add_argument("city", help="city id (cities/<id>.json)")
    parser.add_argument("--cities-dir")
    args = parser.parse_args(argv)
    try:
        city = load_city(args.city, args.cities_dir)
        boundary, basemap, streets = fetch_live(city, fetcher)
        target = save_cache(city["id"], boundary, basemap, streets, args.cities_dir)
    except (ConfigError, BoundaryError, OSError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    print(f"OSM cache for {city['id']} written to {target}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
