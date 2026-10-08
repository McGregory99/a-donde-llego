"""Committed OSM fallback cache: load/save, refresh CLI, and build fallback (no network)."""

import json
import shutil

import pytest
from test_build import NOW, TODAY, STREETS, city_config, overpass, run, load, cities_dir, in_tmp_dir  # noqa: F401

from adl.boundary import BoundaryError
from adl.osm_cache import cache_dir, load_cache, main as refresh_main, save_cache

BOUNDARY = {"id": 7, "polygons": [[[[41.5, -4.8], [41.5, -4.7], [41.7, -4.7], [41.5, -4.8]]]]}
BASEMAP = {"parks": [], "water": [[[[41.5, -4.8], [41.5, -4.7], [41.7, -4.7], [41.5, -4.8]]]]}
CACHED_STREETS = {"lat": [4160000, 100], "lon": [-470000, 0], "ways": [[0, 1]], "cls": [1]}


def down(query):
    raise BoundaryError("Overpass unavailable")


def test_cache_dir_is_relative_to_the_cities_dir(tmp_path):
    assert cache_dir("mini", tmp_path) == tmp_path / "osm-cache" / "mini"


def test_save_then_load_round_trips(tmp_path):
    save_cache("mini", BOUNDARY, BASEMAP, CACHED_STREETS, tmp_path)
    assert load_cache("mini", tmp_path) == (BOUNDARY, BASEMAP, CACHED_STREETS)


def test_load_without_cache_is_a_boundary_error(tmp_path):
    with pytest.raises(BoundaryError, match="no OSM cache"):
        load_cache("mini", tmp_path)


def test_a_cache_without_the_streets_file_still_loads_with_no_streets(tmp_path):
    """Caches seeded before the street graph existed hold only boundary and basemap."""
    save_cache("mini", BOUNDARY, BASEMAP, CACHED_STREETS, tmp_path)
    (cache_dir("mini", tmp_path) / "streets.json").unlink()
    assert load_cache("mini", tmp_path) == (BOUNDARY, BASEMAP, None)


def test_a_cache_missing_the_basemap_is_still_an_error(tmp_path):
    save_cache("mini", BOUNDARY, BASEMAP, CACHED_STREETS, tmp_path)
    (cache_dir("mini", tmp_path) / "basemap.json").unlink()
    with pytest.raises(BoundaryError, match="basemap.json"):
        load_cache("mini", tmp_path)


def test_load_rejects_a_corrupt_cache(tmp_path):
    save_cache("mini", BOUNDARY, BASEMAP, CACHED_STREETS, tmp_path)
    (cache_dir("mini", tmp_path) / "basemap.json").write_text("{nope", encoding="utf-8")
    with pytest.raises(BoundaryError, match="basemap.json"):
        load_cache("mini", tmp_path)


def test_refresh_cli_writes_the_cache_from_live_data(cities_dir, capsys):
    assert refresh_main(["mini", "--cities-dir", str(cities_dir)], fetcher=overpass) == 0
    boundary, basemap, streets = load_cache("mini", cities_dir)
    assert boundary["id"] == 7 and len(basemap["water"]) == 1
    assert streets == STREETS


def test_refresh_cli_failure_keeps_the_old_cache(cities_dir, capsys):
    save_cache("mini", BOUNDARY, BASEMAP, CACHED_STREETS, cities_dir)
    assert refresh_main(["mini", "--cities-dir", str(cities_dir)], fetcher=down) == 1
    assert "Overpass unavailable" in capsys.readouterr().err
    assert load_cache("mini", cities_dir) == (BOUNDARY, BASEMAP, CACHED_STREETS)


def test_build_records_live_source(cities_dir, tmp_path, make_zip):
    assert run(cities_dir, tmp_path / "out", make_zip) == 0
    assert load(tmp_path / "out", "meta.json")["osm"] == {"source": "live"}


def test_build_falls_back_to_the_cache_when_overpass_is_down(cities_dir, tmp_path, make_zip, capsys):
    save_cache("mini", BOUNDARY, BASEMAP, CACHED_STREETS, cities_dir)
    assert run(cities_dir, tmp_path / "out", make_zip, fetcher=down) == 0
    assert "warning" in capsys.readouterr().err.lower()
    assert load(tmp_path / "out", "meta.json")["osm"] == {"source": "cache"}
    assert load(tmp_path / "out", "boundary.json") == BOUNDARY
    assert load(tmp_path / "out", "basemap.json") == BASEMAP
    assert load(tmp_path / "out", "walk.json")["n"] >= 2  # built from the cached streets


def test_build_fails_when_overpass_is_down_and_there_is_no_cache(cities_dir, tmp_path, make_zip, capsys):
    assert run(cities_dir, tmp_path / "out", make_zip, fetcher=down) == 1
    assert "Overpass unavailable" in capsys.readouterr().err


def forbidden(query):
    raise AssertionError("Overpass must not be queried")


def test_build_uses_the_committed_cache_by_default_without_touching_overpass(cities_dir, tmp_path, make_zip):
    save_cache("mini", BOUNDARY, BASEMAP, CACHED_STREETS, cities_dir)
    assert run(cities_dir, tmp_path / "out", make_zip, fetcher=forbidden) == 0
    assert load(tmp_path / "out", "meta.json")["osm"] == {"source": "cache"}
    assert load(tmp_path / "out", "boundary.json") == BOUNDARY


def test_refresh_flag_prefers_live_over_the_cache(cities_dir, tmp_path, make_zip):
    save_cache("mini", {"id": 99, "polygons": []}, {"parks": [], "water": []}, CACHED_STREETS, cities_dir)
    assert run(cities_dir, tmp_path / "out", make_zip, "--refresh-osm") == 0
    assert load(tmp_path / "out", "boundary.json")["id"] == 7
    assert load(tmp_path / "out", "meta.json")["osm"] == {"source": "live"}


def test_refresh_env_var_prefers_live_over_the_cache(cities_dir, tmp_path, make_zip, monkeypatch):
    save_cache("mini", {"id": 99, "polygons": []}, {"parks": [], "water": []}, CACHED_STREETS, cities_dir)
    monkeypatch.setenv("ADL_REFRESH_OSM", "1")
    assert run(cities_dir, tmp_path / "out", make_zip) == 0
    assert load(tmp_path / "out", "boundary.json")["id"] == 7


def test_a_failed_refresh_still_falls_back_to_the_cache(cities_dir, tmp_path, make_zip, capsys):
    save_cache("mini", BOUNDARY, BASEMAP, CACHED_STREETS, cities_dir)
    assert run(cities_dir, tmp_path / "out", make_zip, "--refresh-osm", fetcher=down) == 0
    assert "warning" in capsys.readouterr().err.lower()
    assert load(tmp_path / "out", "meta.json")["osm"] == {"source": "cache"}


def test_a_straight_city_builds_from_a_cache_without_streets(cities_dir, tmp_path, make_zip):
    save_cache("mini", BOUNDARY, BASEMAP, CACHED_STREETS, cities_dir)
    (cache_dir("mini", cities_dir) / "streets.json").unlink()
    assert run(cities_dir, tmp_path / "out", make_zip, fetcher=forbidden) == 0
    assert load(tmp_path / "out", "boundary.json") == BOUNDARY
    assert load(tmp_path / "out", "walk.json")["n"] == 0


def streets_city(cities_dir):
    config = json.loads((cities_dir / "mini.json").read_text())
    config["modes"]["foot"]["network"] = "streets"
    (cities_dir / "mini.json").write_text(json.dumps(config), encoding="utf-8")


def test_a_streets_city_with_a_cache_lacking_streets_fetches_live(cities_dir, tmp_path, make_zip):
    streets_city(cities_dir)
    save_cache("mini", BOUNDARY, BASEMAP, CACHED_STREETS, cities_dir)
    (cache_dir("mini", cities_dir) / "streets.json").unlink()
    assert run(cities_dir, tmp_path / "out", make_zip) == 0
    assert load(tmp_path / "out", "meta.json")["osm"] == {"source": "live"}
    assert load(tmp_path / "out", "walk.json")["n"] >= 2


def test_a_streets_city_with_a_cache_lacking_streets_and_no_overpass_says_so(cities_dir, tmp_path, make_zip, capsys):
    streets_city(cities_dir)
    save_cache("mini", BOUNDARY, BASEMAP, CACHED_STREETS, cities_dir)
    (cache_dir("mini", cities_dir) / "streets.json").unlink()
    assert run(cities_dir, tmp_path / "out", make_zip, fetcher=down) == 1
    assert "streets" in capsys.readouterr().err
    assert not (tmp_path / "out" / "mini").exists()


def test_skip_osm_with_a_streets_network_is_a_clear_error(cities_dir, tmp_path, make_zip, capsys):
    streets_city(cities_dir)
    assert run(cities_dir, tmp_path / "out", make_zip, "--skip-osm", fetcher=forbidden) == 1
    err = capsys.readouterr().err
    assert "--skip-osm" in err and "streets" in err
    assert not (tmp_path / "out" / "mini").exists()


def test_skip_osm_ignores_the_cache_and_records_it(cities_dir, tmp_path, make_zip):
    save_cache("mini", BOUNDARY, BASEMAP, CACHED_STREETS, cities_dir)
    assert run(cities_dir, tmp_path / "out", make_zip, "--skip-osm", fetcher=down) == 0
    assert load(tmp_path / "out", "meta.json")["osm"] == {"source": "skipped"}
    assert load(tmp_path / "out", "boundary.json")["polygons"] == []


def test_every_committed_cache_is_loadable_and_non_empty():
    from adl.config import CITIES_DIR

    cached = [p.name for p in (CITIES_DIR / "osm-cache").iterdir() if p.is_dir()]
    assert cached
    for city in cached:
        boundary, basemap, streets = load_cache(city)
        assert boundary["polygons"] and (basemap["water"] or basemap["parks"]), city
        assert streets["ways"], city
