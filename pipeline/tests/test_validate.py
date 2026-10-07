"""R2.2: GTFS validation (required files/fields, referential integrity, parsing)."""

import io
import zipfile
from datetime import date

import pytest

from adl.gtfs_validate import GtfsError, feed_validity, read_feed, validate_feed


def test_valid_feed_passes(make_zip):
    validate_feed(read_feed(make_zip("mini_gtfs")))


def test_unknown_stop_id_fails_naming_the_id(make_zip):
    feed = read_feed(make_zip("badref_gtfs"))
    with pytest.raises(GtfsError, match="S9"):
        validate_feed(feed)


def test_missing_required_file_is_named(make_zip, tmp_path):
    src = make_zip("mini_gtfs")
    out = tmp_path / "nostops.zip"
    with zipfile.ZipFile(src) as zin, zipfile.ZipFile(out, "w") as zout:
        for n in zin.namelist():
            if n != "stops.txt":
                zout.writestr(n, zin.read(n))
    with pytest.raises(GtfsError, match="stops.txt"):
        validate_feed(read_feed(out))


def test_missing_required_field_is_named(make_zip):
    feed = read_feed(make_zip("mini_gtfs"))
    for row in feed["stops.txt"]:
        del row["stop_lat"]
    with pytest.raises(GtfsError, match="stops.txt.*stop_lat"):
        validate_feed(feed)


def test_dates_only_feed_with_padded_header_and_crlf_parses(make_zip):
    feed = read_feed(make_zip("dates_only_gtfs"))
    assert feed["calendar.txt"] == []
    assert "stop_name" in feed["stops.txt"][0]
    validate_feed(feed)
    assert feed_validity(feed) == (date(2026, 10, 7), date(2026, 12, 27))


def test_validity_from_calendar_rows(make_zip):
    feed = read_feed(make_zip("mini_gtfs"))
    assert feed_validity(feed) == (date(2026, 1, 1), date(2027, 12, 31))


def test_feed_without_any_service_dates_fails(make_zip):
    feed = read_feed(make_zip("mini_gtfs"))
    feed["calendar.txt"] = []
    with pytest.raises(GtfsError, match="calendar"):
        feed_validity(feed)


def test_non_zip_is_rejected(tmp_path):
    bad = tmp_path / "bad.zip"
    bad.write_bytes(b"<html>not a zip</html>")
    with pytest.raises(GtfsError, match="zip"):
        read_feed(bad)


@pytest.mark.parametrize("name", ["../evil.txt", "/abs.txt", "a/../../b.txt", "dir\\..\\x.txt"])
def test_unsafe_member_paths_are_rejected(make_zip, name):
    path = make_zip("mini_gtfs", extra={name: b"x"})
    with pytest.raises(GtfsError, match="unsafe"):
        read_feed(path)


def test_uncompressed_size_cap_blocks_zip_bombs(make_zip):
    path = make_zip("mini_gtfs", extra={"big.txt": b"0" * 10_000})
    with pytest.raises(GtfsError, match="too large"):
        read_feed(path, max_bytes=1_000)


def test_binary_members_are_not_parsed(make_zip):
    path = make_zip("mini_gtfs", extra={"payload.bin": b"\x00\x01"})
    assert "payload.bin" not in read_feed(path)
