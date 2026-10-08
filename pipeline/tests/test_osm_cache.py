"""Committed OSM fallback cache: load/save, refresh CLI, and build fallback (no network)."""

import json
import shutil

import pytest
from test_build import NOW, TODAY, city_config, overpass, run, load, cities_dir, in_tmp_dir  # noqa: F401

from adl.boundary import BoundaryError
from adl.osm_cache import cache_dir, load_cache, main as refresh_main, save_cache

BOUNDARY = {"id": 7, "polygons": [[[[41.5, -4.8], [41.5, -4.7], [41.7, -4.7], [41.5, -4.8]]]]}
BASEMAP = {"parks": [], "water": [[[[41.5, -4.8], [41.5, -4.7], [41.7, -4.7], [41.5, -4.8]]]]}


def down(query):
    raise BoundaryError("Overpass unavailable")


def test_cache_dir_is_relative_to_the_cities_dir(tmp_path):
    assert cache_dir("mini", tmp_path) == tmp_path / "osm-cache" / "mini"


def test_save_then_load_round_trips(tmp_path):
    save_cache("mini", BOUNDARY, BASEMAP, tmp_path)
    assert load_cache("mini", tmp_path) == (BOUNDARY, BASEMAP)


def test_load_without_cache_is_a_boundary_error(tmp_path):
    with pytest.raises(BoundaryError, match="no OSM cache"):
        load_cache("mini", tmp_path)


def test_load_rejects_a_corrupt_cache(tmp_path):
    save_cache("mini", BOUNDARY, BASEMAP, tmp_path)
    (cache_dir("mini", tmp_path) / "basemap.json").write_text("{nope", encoding="utf-8")
    with pytest.raises(BoundaryError, match="basemap.json"):
        load_cache("mini", tmp_path)


def test_refresh_cli_writes_the_cache_from_live_data(cities_dir, capsys):
    assert refresh_main(["mini", "--cities-dir", str(cities_dir)], fetcher=overpass) == 0
    boundary, basemap = load_cache("mini", cities_dir)
    assert boundary["id"] == 7 and len(basemap["water"]) == 1


def test_refresh_cli_failure_keeps_the_old_cache(cities_dir, capsys):
    save_cache("mini", BOUNDARY, BASEMAP, cities_dir)
    assert refresh_main(["mini", "--cities-dir", str(cities_dir)], fetcher=down) == 1
    assert "Overpass unavailable" in capsys.readouterr().err
    assert load_cache("mini", cities_dir) == (BOUNDARY, BASEMAP)


def test_build_records_live_source(cities_dir, tmp_path, make_zip):
    assert run(cities_dir, tmp_path / "out", make_zip) == 0
    assert load(tmp_path / "out", "meta.json")["osm"] == {"source": "live"}


def test_build_falls_back_to_the_cache_when_overpass_is_down(cities_dir, tmp_path, make_zip, capsys):
    save_cache("mini", BOUNDARY, BASEMAP, cities_dir)
    assert run(cities_dir, tmp_path / "out", make_zip, fetcher=down) == 0
    assert "warning" in capsys.readouterr().err.lower()
    assert load(tmp_path / "out", "meta.json")["osm"] == {"source": "cache"}
    assert load(tmp_path / "out", "boundary.json") == BOUNDARY
    assert load(tmp_path / "out", "basemap.json") == BASEMAP


def test_build_fails_when_overpass_is_down_and_there_is_no_cache(cities_dir, tmp_path, make_zip, capsys):
    assert run(cities_dir, tmp_path / "out", make_zip, fetcher=down) == 1
    assert "Overpass unavailable" in capsys.readouterr().err


def test_build_prefers_live_over_the_cache(cities_dir, tmp_path, make_zip):
    save_cache("mini", {"id": 99, "polygons": []}, {"parks": [], "water": []}, cities_dir)
    assert run(cities_dir, tmp_path / "out", make_zip) == 0
    assert load(tmp_path / "out", "boundary.json")["id"] == 7


def test_skip_osm_ignores_the_cache_and_records_it(cities_dir, tmp_path, make_zip):
    save_cache("mini", BOUNDARY, BASEMAP, cities_dir)
    assert run(cities_dir, tmp_path / "out", make_zip, "--skip-osm", fetcher=down) == 0
    assert load(tmp_path / "out", "meta.json")["osm"] == {"source": "skipped"}
    assert load(tmp_path / "out", "boundary.json")["polygons"] == []


def test_every_committed_cache_is_loadable_and_non_empty():
    from adl.config import CITIES_DIR

    cached = [p.name for p in (CITIES_DIR / "osm-cache").iterdir() if p.is_dir()]
    assert cached
    for city in cached:
        boundary, basemap = load_cache(city)
        assert boundary["polygons"] and (basemap["water"] or basemap["parks"]), city
