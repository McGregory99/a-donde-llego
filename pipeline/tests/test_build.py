"""R2.1, R2.5, R2.6: build CLI end to end on fixtures (no network), golden files, determinism."""

import json
import os
import shutil
from datetime import datetime, timezone
from pathlib import Path

import pytest

from adl.boundary import BoundaryError
from adl.build import ASSET_FILES, main

GOLDEN = Path(__file__).parent / "golden" / "build_mini"
CITIES = Path(__file__).resolve().parents[2] / "cities"
NOW = datetime(2026, 10, 7, 12, 0, tzinfo=timezone.utc)
TODAY = "2026-10-07"
RING = [{"lat": 41.5, "lon": -4.8}, {"lat": 41.5, "lon": -4.7}, {"lat": 41.7, "lon": -4.7},
        {"lat": 41.5, "lon": -4.8}]


def city_config(**overrides) -> dict:
    config = {
        "id": "mini", "name": "Mini", "bbox": [-4.8, 41.5, -4.7, 41.7], "center": [41.61, -4.74],
        "locale": "es", "geocoder": {"provider": "photon"}, "boundary": {"osm_relation_id": 7},
        "gtfs": {"sources": ["http://feed.invalid/gtfs.zip"], "license": "CC BY 3.0", "attribution": "Test"},
        "modes": {  # mode ids are arbitrary: nothing in the pipeline may know them
            "foot": {"kind": "walk"},
            "road": {"kind": "transit", "route_types": [3]},
        },
        "window": {"start": "07:00", "end": "20:00"},
    }
    config.update(overrides)
    return config


@pytest.fixture
def cities_dir(tmp_path):
    path = tmp_path / "cities"
    path.mkdir()
    shutil.copy(CITIES / "schema.json", path / "schema.json")
    (path / "mini.json").write_text(json.dumps(city_config()), encoding="utf-8")
    return path


@pytest.fixture(autouse=True)
def in_tmp_dir(tmp_path, monkeypatch):
    """Feeds are passed by relative path so feed.source is the same in every run (golden files)."""
    monkeypatch.chdir(tmp_path)


STREET_WAYS = [{"type": "way", "id": 5, "tags": {"highway": "residential"}, "nodes": [1, 2],
                "geometry": [{"lat": 41.6, "lon": -4.75}, {"lat": 41.601, "lon": -4.75}]}]
STREETS = {"lat": [4160000, 100], "lon": [-475000, 0], "ways": [[0, 1]], "cls": [1]}  # what STREET_WAYS packs to


def overpass(query: str) -> dict:
    if "highway" in query:
        return {"elements": STREET_WAYS}
    if "relation(7)" in query:
        return {"elements": [{"type": "relation", "id": 7, "members": [
            {"type": "way", "role": "outer", "geometry": RING}]}]}
    return {"elements": [{"type": "way", "id": 1, "tags": {"natural": "water"}, "geometry": RING}]}


def run(cities_dir, out, make_zip, *extra, fetcher=overpass, now=NOW, fixture="mini_gtfs"):
    argv = ["mini", "--out", str(out), "--cities-dir", str(cities_dir), "--today", TODAY,
            "--gtfs-file", make_zip(fixture).name, *extra]
    return main(argv, fetcher=fetcher, now=now)


def load(out, name):
    return json.loads((Path(out) / "mini" / name).read_text(encoding="utf-8"))


def test_build_writes_only_static_json_assets(cities_dir, tmp_path, make_zip):
    assert run(cities_dir, tmp_path / "out", make_zip) == 0
    produced = sorted(p.name for p in (tmp_path / "out" / "mini").iterdir())
    assert produced == sorted(ASSET_FILES)
    assert all(name.endswith(".json") for name in produced)


def test_graph_asset_carries_what_the_client_needs(cities_dir, tmp_path, make_zip):
    run(cities_dir, tmp_path / "out", make_zip)
    graph = load(tmp_path / "out", "graph.json")
    assert [s["id"] for s in graph["stops"]] == ["S1", "S2", "S3", "S4"]
    assert [(l["id"], l["name"], l["mode"]) for l in graph["lines"]] == [
        ("R1:0", "1", "road"), ("R2:0", "2", "road"), ("R3:0", "3", "road")]
    assert graph["lines"][0]["long_name"] == "Line One"
    assert graph["rides"][0] == [0, 0, 1, 5.0]  # [line, from stop, to stop, minutes]
    assert [w[:2] for w in graph["waits"]][:2] == [[0, 0], [1, 1]]  # [stop, line, minutes]
    assert graph["walk"]["speed_m_per_min"] == 75
    assert graph["modes"]["road"]["transfer_min"] == 1.5
    assert len(graph["neighbors"]) == 4


def test_walk_asset_holds_the_street_graph_and_where_each_stop_snaps(cities_dir, tmp_path, make_zip):
    run(cities_dir, tmp_path / "out", make_zip)
    walk = load(tmp_path / "out", "walk.json")
    assert walk["n"] >= 2 and len(walk["lat"]) == walk["n"] == len(walk["deg"])
    assert set(walk["stops"]) == {"node", "snap_m"}
    assert len(walk["stops"]["node"]) == len(load(tmp_path / "out", "graph.json")["stops"])
    assert walk["stops"]["node"][0] >= 0 and -1 in walk["stops"]["node"]  # S1 is by the street, others are far


def test_skipping_osm_gives_an_empty_walk_graph(cities_dir, tmp_path, make_zip):
    assert run(cities_dir, tmp_path / "out", make_zip, "--skip-osm") == 0
    assert load(tmp_path / "out", "walk.json")["n"] == 0


def test_streets_network_is_used_for_the_graph_asset(cities_dir, tmp_path, make_zip):
    config = json.loads((cities_dir / "mini.json").read_text())
    config["modes"]["foot"]["network"] = "streets"
    (cities_dir / "mini.json").write_text(json.dumps(config), encoding="utf-8")
    assert run(cities_dir, tmp_path / "out", make_zip) == 0
    assert load(tmp_path / "out", "graph.json")["walk"]["network"] == "streets"


def test_meta_records_feed_validity_source_and_build_timestamp(cities_dir, tmp_path, make_zip):
    run(cities_dir, tmp_path / "out", make_zip)
    meta = load(tmp_path / "out", "meta.json")
    assert meta["city"] == {"id": "mini", "name": "Mini"}
    assert meta["built_at"] == "2026-10-07T12:00:00+00:00"
    assert meta["reference_date"] == "2026-10-07"
    assert meta["feed"]["valid_from"] == "2026-01-01" and meta["feed"]["valid_to"] == "2027-12-31"
    assert meta["feed"]["source"] == "feed.zip" and meta["feed"]["expired"] is False


def test_stats_boundary_basemap_and_lines_assets(cities_dir, tmp_path, make_zip):
    run(cities_dir, tmp_path / "out", make_zip)
    out = tmp_path / "out"
    assert load(out, "stats.json")["stops"] == 4
    assert load(out, "stats.json")["reach"]["scope"] == "boundary"
    assert load(out, "boundary.json")["id"] == 7 and len(load(out, "boundary.json")["polygons"]) == 1
    assert len(load(out, "basemap.json")["water"]) == 1
    lines = load(out, "lines.json")
    assert [l["id"] for l in lines["lines"]] == ["R1:0", "R2:0", "R3:0"]
    assert all(l["source"] == "stops" for l in lines["lines"])
    assert len(lines["warnings"]) == 3


def test_output_matches_golden_files(cities_dir, tmp_path, make_zip):
    run(cities_dir, tmp_path / "out", make_zip)
    built = tmp_path / "out" / "mini"
    if os.environ.get("ADL_UPDATE_GOLDEN"):
        shutil.rmtree(GOLDEN, ignore_errors=True)
        shutil.copytree(built, GOLDEN)
    assert sorted(p.name for p in GOLDEN.iterdir()) == sorted(ASSET_FILES)
    for name in ASSET_FILES:
        assert (built / name).read_bytes() == (GOLDEN / name).read_bytes(), name


def test_identical_inputs_give_identical_bytes_apart_from_the_build_timestamp(cities_dir, tmp_path, make_zip):
    run(cities_dir, tmp_path / "a", make_zip)
    run(cities_dir, tmp_path / "b", make_zip, now=datetime(2026, 10, 7, 18, 30, tzinfo=timezone.utc))
    differing = [n for n in ASSET_FILES
                 if (tmp_path / "a" / "mini" / n).read_bytes() != (tmp_path / "b" / "mini" / n).read_bytes()]
    assert differing == ["meta.json"]
    meta_a, meta_b = load(tmp_path / "a", "meta.json"), load(tmp_path / "b", "meta.json")
    assert {k: v for k, v in meta_a.items() if k != "built_at"} == {k: v for k, v in meta_b.items() if k != "built_at"}


def test_expired_feed_fails_without_override_and_writes_nothing(cities_dir, tmp_path, make_zip, capsys):
    assert run(cities_dir, tmp_path / "out", make_zip, fixture="expired_gtfs") == 2
    assert "expired on 2026-03-20" in capsys.readouterr().err
    assert not (tmp_path / "out" / "mini").exists()


def test_allow_expired_builds_warns_and_marks_metadata(cities_dir, tmp_path, make_zip, capsys):
    assert run(cities_dir, tmp_path / "out", make_zip, "--allow-expired", fixture="expired_gtfs") == 0
    assert "expired" in capsys.readouterr().err
    assert load(tmp_path / "out", "meta.json")["feed"]["expired"] is True
    assert load(tmp_path / "out", "stats.json")["feed"]["expired"] is True


def test_city_without_boundary_skips_the_relation_query(cities_dir, tmp_path, make_zip):
    config = city_config()
    del config["boundary"]
    (cities_dir / "mini.json").write_text(json.dumps(config), encoding="utf-8")
    queries = []

    def fetcher(query):
        queries.append(query)
        return overpass(query)

    assert run(cities_dir, tmp_path / "out", make_zip, fetcher=fetcher) == 0
    assert load(tmp_path / "out", "boundary.json") == {"id": None, "polygons": []}
    assert load(tmp_path / "out", "stats.json")["reach"]["scope"] == "served"
    assert queries and all("relation" not in q for q in queries)


def test_skip_osm_builds_offline_with_empty_context(cities_dir, tmp_path, make_zip):
    def forbidden(query):
        raise AssertionError("network used")

    assert run(cities_dir, tmp_path / "out", make_zip, "--skip-osm", fetcher=forbidden) == 0
    assert load(tmp_path / "out", "boundary.json")["polygons"] == []
    assert load(tmp_path / "out", "basemap.json") == {"parks": [], "water": []}


def test_failed_build_keeps_the_previous_output(cities_dir, tmp_path, make_zip, capsys):
    out = tmp_path / "out"
    assert run(cities_dir, out, make_zip) == 0
    before = (out / "mini" / "graph.json").read_bytes()

    def down(query):
        raise BoundaryError("Overpass unavailable")

    assert run(cities_dir, out, make_zip, fetcher=down) == 1
    assert "Overpass unavailable" in capsys.readouterr().err
    assert (out / "mini" / "graph.json").read_bytes() == before
    assert sorted(p.name for p in out.iterdir()) == ["mini"]  # no half-written leftovers


def test_rebuild_replaces_the_previous_output_cleanly(cities_dir, tmp_path, make_zip):
    out = tmp_path / "out"
    assert run(cities_dir, out, make_zip) == 0
    assert run(cities_dir, out, make_zip) == 0
    assert sorted(p.name for p in (out / "mini").iterdir()) == sorted(ASSET_FILES)
    assert sorted(p.name for p in out.iterdir()) == ["mini"]  # old build removed, no leftovers


def test_missing_city_config_is_a_clear_error(cities_dir, tmp_path, make_zip, capsys):
    argv = ["nowhere", "--out", str(tmp_path / "out"), "--cities-dir", str(cities_dir),
            "--gtfs-file", make_zip("mini_gtfs").name]
    assert main(argv, fetcher=overpass, now=NOW) == 1
    assert "nowhere.json" in capsys.readouterr().err


def test_default_output_root_is_dist_data_at_the_repository_root_whatever_the_cwd():
    from adl.build import DEFAULT_OUT

    assert DEFAULT_OUT == Path(__file__).resolve().parents[2] / "dist" / "data"
