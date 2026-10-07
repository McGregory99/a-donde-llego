"""R1.1-R1.4: city config loading, validation and per-mode overrides."""

import copy
import json
from pathlib import Path

import pytest

from adl.config import ConfigError, load_city

REPO = Path(__file__).resolve().parents[2]

VALID = {
    "id": "foo",
    "name": "Foo",
    "bbox": [-1.0, 40.0, 1.0, 41.0],
    "center": [40.5, 0.0],
    "locale": "es",
    "geocoder": {"provider": "photon"},
    "boundary": {"osm_relation_id": 1},
    "gtfs": {
        "sources": ["http://example.test/feed.zip"],
        "license": "CC BY 3.0 ES",
        "attribution": "Fuente: Foo",
    },
    "modes": {
        "walk": {"kind": "walk"},
        "bus": {"kind": "transit", "route_types": [3]},
    },
    "window": {"start": "07:00", "end": "20:00"},
}


def write_city(tmp_path, data, name="foo"):
    (tmp_path / f"{name}.json").write_text(json.dumps(data), encoding="utf-8")
    return tmp_path


def test_valid_config_loads_walk_and_transit_modes(tmp_path):
    city = load_city("foo", write_city(tmp_path, VALID))
    assert city["id"] == "foo"
    assert set(city["modes"]) == {"walk", "bus"}
    assert city["modes"]["walk"]["speed_m_per_min"] == 75
    assert city["modes"]["bus"]["wait"] == {"factor": 0.5, "min": 1, "max": 15}
    assert city["modes"]["bus"]["transfer_min"] == 1.5


def test_missing_gtfs_fails_naming_file_and_field(tmp_path):
    data = copy.deepcopy(VALID)
    del data["gtfs"]
    cities = write_city(tmp_path, data)
    with pytest.raises(ConfigError) as err:
        load_city("foo", cities)
    assert "foo.json" in str(err.value)
    assert "gtfs" in str(err.value)


def test_missing_city_file_fails_naming_file(tmp_path):
    with pytest.raises(ConfigError, match="nope.json"):
        load_city("nope", tmp_path)


def test_new_city_with_different_modes_loads_without_code_change(tmp_path):
    data = copy.deepcopy(VALID)
    data["id"] = "bar"
    data["modes"] = {
        "walk": {"kind": "walk", "speed_m_per_min": 60},
        "tram": {"kind": "transit", "route_types": [0]},
    }
    city = load_city("bar", write_city(tmp_path, data, "bar"))
    assert set(city["modes"]) == {"walk", "tram"}
    assert city["modes"]["walk"]["speed_m_per_min"] == 60


def test_wait_cap_override_is_honored(tmp_path):
    data = copy.deepcopy(VALID)
    data["modes"]["bus"]["wait"] = {"max": 10}
    city = load_city("foo", write_city(tmp_path, data))
    assert city["modes"]["bus"]["wait"] == {"factor": 0.5, "min": 1, "max": 10}


def test_id_must_match_file_name(tmp_path):
    data = copy.deepcopy(VALID)
    data["id"] = "other"
    with pytest.raises(ConfigError, match="id"):
        load_city("foo", write_city(tmp_path, data))


def test_bad_bbox_names_field(tmp_path):
    data = copy.deepcopy(VALID)
    data["bbox"] = [1.0, 2.0]
    with pytest.raises(ConfigError, match="bbox"):
        load_city("foo", write_city(tmp_path, data))


def test_shipped_valladolid_config_loads():
    city = load_city("valladolid", REPO / "cities")
    assert city["boundary"]["osm_relation_id"] == 348849
    assert city["bbox"] == [-4.9281803, 41.5231281, -4.6308064, 41.8155086]
    assert city["center"] == [41.62, -4.72599]
    assert city["gtfs"]["license"] == "CC BY 3.0 ES"
    assert city["gtfs"]["attribution"] == "Fuente: AUVASA"
    assert city["gtfs"]["sources"] == [
        "http://212.170.201.204:50080/GTFSRTapi/api/GTFSFile"
    ]
    assert set(city["modes"]) == {"walk", "bus"}


def test_schema_is_read_from_the_cities_dir_override(tmp_path):
    write_city(tmp_path, VALID)
    (tmp_path / "schema.json").write_text(
        json.dumps({"type": "object", "required": ["marker"]}), encoding="utf-8"
    )
    with pytest.raises(ConfigError, match="marker"):
        load_city("foo", tmp_path)


def test_non_utf8_file_is_a_config_error(tmp_path):
    (tmp_path / "foo.json").write_bytes(b"\xff\xfe\x00bad")
    with pytest.raises(ConfigError, match="foo.json"):
        load_city("foo", tmp_path)


def test_unreadable_path_is_a_config_error(tmp_path):
    (tmp_path / "foo.json").mkdir()
    with pytest.raises(ConfigError, match="foo.json"):
        load_city("foo", tmp_path)


def test_non_object_json_is_a_config_error(tmp_path):
    (tmp_path / "foo.json").write_text("[1, 2]", encoding="utf-8")
    with pytest.raises(ConfigError, match="foo.json.*object"):
        load_city("foo", tmp_path)
