"""R2.1: ordered source resolution, local override, untrusted download limits."""

import io
import json
import shutil
from datetime import date
from pathlib import Path

import pytest

from adl.fetch import FetchError, fetch_gtfs, main
from adl.gtfs_validate import ExpiredFeedError, GtfsError

TODAY = date(2026, 10, 7)


class FakeResponse(io.BytesIO):
    def __init__(self, data: bytes, length: int | None = None):
        super().__init__(data)
        self.headers = {} if length is None else {"Content-Length": str(length)}

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()


def opener_for(mapping):
    calls = []

    def opener(url, timeout=None):
        calls.append(url)
        value = mapping[url]
        if isinstance(value, Exception):
            raise value
        return FakeResponse(value)

    opener.calls = calls
    return opener


def zip_bytes(make_zip, fixture):
    return make_zip(fixture, name=f"{fixture}.zip").read_bytes()


def test_first_current_source_wins(make_zip, tmp_path):
    opener = opener_for(
        {
            "http://a.test/old.zip": zip_bytes(make_zip, "expired_gtfs"),
            "http://b.test/new.zip": zip_bytes(make_zip, "mini_gtfs"),
            "http://c.test/never.zip": b"",
        }
    )
    result = fetch_gtfs(["http://a.test/old.zip", "http://b.test/new.zip", "http://c.test/never.zip"], tmp_path / "out", TODAY, opener=opener)
    assert result.source == "http://b.test/new.zip"
    assert result.expired is False
    assert opener.calls == ["http://a.test/old.zip", "http://b.test/new.zip"]
    assert result.path.read_bytes() == zip_bytes(make_zip, "mini_gtfs")


def test_plain_http_dates_only_source_is_accepted(make_zip, tmp_path):
    url = "http://212.0.0.1:50080/feed"
    opener = opener_for({url: zip_bytes(make_zip, "dates_only_gtfs")})
    result = fetch_gtfs([url], tmp_path / "out", TODAY, opener=opener)
    assert (result.valid_from, result.valid_to) == (date(2026, 10, 7), date(2026, 12, 27))


def test_all_expired_fails_with_expiry_error(make_zip, tmp_path):
    opener = opener_for({"http://a.test/old.zip": zip_bytes(make_zip, "expired_gtfs")})
    with pytest.raises(ExpiredFeedError, match="2026-03-20"):
        fetch_gtfs(["http://a.test/old.zip"], tmp_path / "out", TODAY, opener=opener)


def test_allow_expired_falls_back_to_first_valid_feed(make_zip, tmp_path):
    opener = opener_for({"http://a.test/old.zip": zip_bytes(make_zip, "expired_gtfs")})
    result = fetch_gtfs(
        ["http://a.test/old.zip"], tmp_path / "out", TODAY, allow_expired=True, opener=opener
    )
    assert result.expired is True


def test_failing_source_is_skipped_and_all_failing_raises(make_zip, tmp_path):
    good = zip_bytes(make_zip, "mini_gtfs")
    opener = opener_for({"http://a.test/x": OSError("boom"), "http://b.test/y": good})
    assert fetch_gtfs(["http://a.test/x", "http://b.test/y"], tmp_path / "o1", TODAY, opener=opener).source == "http://b.test/y"
    with pytest.raises(FetchError, match="boom"):
        fetch_gtfs(["http://a.test/x"], tmp_path / "o2", TODAY, opener=opener)


def test_invalid_feed_source_is_skipped(make_zip, tmp_path):
    opener = opener_for(
        {"http://a.test/bad": zip_bytes(make_zip, "badref_gtfs"), "http://b.test/ok": zip_bytes(make_zip, "mini_gtfs")}
    )
    result = fetch_gtfs(["http://a.test/bad", "http://b.test/ok"], tmp_path / "out", TODAY, opener=opener)
    assert result.source == "http://b.test/ok"


def test_download_over_cap_is_rejected_while_streaming(tmp_path):
    opener = opener_for({"http://a.test/big": b"0" * 5000})
    with pytest.raises(FetchError, match="exceeds"):
        fetch_gtfs(["http://a.test/big"], tmp_path / "out", TODAY, opener=opener, max_bytes=1000)


def test_declared_content_length_over_cap_is_rejected(tmp_path):
    def opener(url, timeout=None):
        return FakeResponse(b"x", length=10**9)

    with pytest.raises(FetchError, match="exceeds"):
        fetch_gtfs(["http://a.test/big"], tmp_path / "out", TODAY, opener=opener)


def test_zip_slip_member_in_download_is_rejected(make_zip, tmp_path):
    evil = make_zip("mini_gtfs", name="evil.zip", extra={"../evil.txt": b"x"}).read_bytes()
    opener = opener_for({"http://a.test/evil": evil})
    with pytest.raises(FetchError, match="unsafe"):
        fetch_gtfs(["http://a.test/evil"], tmp_path / "out", TODAY, opener=opener)


def test_gtfs_file_override_skips_the_network(make_zip, tmp_path):
    local = make_zip("mini_gtfs")

    def opener(*a, **k):
        raise AssertionError("network used")

    result = fetch_gtfs([], tmp_path / "out", TODAY, gtfs_file=local, opener=opener)
    assert result.source == str(local)
    assert (tmp_path / "out" / "gtfs.zip").exists()


def test_cli_writes_metadata_from_city_config(make_zip, tmp_path):
    cities = tmp_path / "cities"
    cities.mkdir()
    repo = Path(__file__).resolve().parents[2]
    shutil.copy(repo / "cities" / "schema.json", cities / "schema.json")
    city = json.loads((repo / "cities" / "valladolid.json").read_text(encoding="utf-8"))
    city["id"] = "foo"
    city["gtfs"]["sources"] = []
    (cities / "foo.json").write_text(json.dumps(city), encoding="utf-8")
    out = tmp_path / "out"
    code = main(
        ["foo", "--cities-dir", str(cities), "--gtfs-file", str(make_zip("mini_gtfs")),
         "--out", str(out), "--today", "2026-10-07"]
    )
    assert code == 0
    meta = json.loads((out / "feed-meta.json").read_text(encoding="utf-8"))
    assert meta["expired"] is False and meta["valid_from"] == "2026-01-01"
