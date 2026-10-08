"""Safe GTFS reading plus validation and expiry checks (R2.2, R2.3).

Feeds are untrusted downloads: members are only ever parsed in memory as CSV
text (never extracted to disk), unsafe member paths are rejected and the total
uncompressed size is capped.
"""

from __future__ import annotations

import csv
import io
import zipfile
import zlib
from datetime import date, datetime
from pathlib import Path, PurePosixPath

MAX_ZIP_BYTES = 100 * 1024 * 1024

REQUIRED_FIELDS = {
    "agency.txt": ("agency_name", "agency_url", "agency_timezone"),
    "stops.txt": ("stop_id", "stop_name", "stop_lat", "stop_lon"),
    "routes.txt": ("route_id", "route_type"),
    "trips.txt": ("route_id", "service_id", "trip_id"),
    "stop_times.txt": ("trip_id", "stop_id", "stop_sequence"),
}
CALENDAR_FILES = ("calendar.txt", "calendar_dates.txt")

Feed = dict[str, list[dict[str, str]]]


class GtfsError(Exception):
    """The feed is unreadable, unsafe or invalid."""


class ExpiredFeedError(GtfsError):
    """The feed validity ended before the build date."""

    def __init__(self, valid_to: date, today: date):
        self.valid_to = valid_to
        super().__init__(f"feed expired on {valid_to.isoformat()} (build date {today.isoformat()})")


def _is_unsafe(name: str) -> bool:
    if "\\" in name or name.startswith("/") or (len(name) > 1 and name[1] == ":"):
        return True
    return ".." in PurePosixPath(name).parts


def _parse_csv(raw: bytes, name: str) -> list[dict[str, str]]:
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise GtfsError(f"{name}: not valid UTF-8") from None
    reader = csv.reader(io.StringIO(text, newline=""))
    header = next(reader, None)
    if header is None:
        return []
    header = [h.strip() for h in header]
    return [
        dict(zip(header, (v.strip() for v in row)))
        for row in reader
        if any(v.strip() for v in row)
    ]


def read_feed(path: Path | str, max_bytes: int = MAX_ZIP_BYTES) -> Feed:
    """Read every ``.txt`` member of a GTFS zip into rows of stripped strings."""
    try:
        zf = zipfile.ZipFile(path)
    except (zipfile.BadZipFile, OSError) as exc:
        raise GtfsError(f"{Path(path).name}: not a valid zip file ({exc})") from None
    with zf:
        infos = zf.infolist()
        for info in infos:
            if _is_unsafe(info.filename):
                raise GtfsError(f"unsafe member path in zip: {info.filename!r}")
        if sum(i.file_size for i in infos) > max_bytes:
            raise GtfsError(f"zip content too large (limit {max_bytes} bytes)")
        feed: Feed = {}
        for i in infos:
            if not i.filename.endswith(".txt") or i.is_dir():
                continue
            try:
                raw = zf.read(i)
            except (zipfile.BadZipFile, zlib.error, EOFError, NotImplementedError, RuntimeError, OSError) as exc:
                raise GtfsError(f"{i.filename}: cannot be read from zip ({exc})") from None
            feed[i.filename] = _parse_csv(raw, i.filename)
        return feed


def validate_feed(feed: Feed) -> None:
    """Check required files/fields and referential integrity; raise GtfsError."""
    for name, fields in REQUIRED_FIELDS.items():
        if name not in feed:
            raise GtfsError(f"missing required file {name}")
        if not feed[name]:
            raise GtfsError(f"{name}: no rows")
        for field in fields:
            if any(field not in row for row in feed[name]):
                raise GtfsError(f"{name}: missing required field '{field}'")
    if not any(name in feed for name in CALENDAR_FILES):
        raise GtfsError("missing calendar.txt and calendar_dates.txt")

    stops = {r["stop_id"] for r in feed["stops.txt"]}
    routes = {r["route_id"] for r in feed["routes.txt"]}
    trips = {r["trip_id"] for r in feed["trips.txt"]}
    checks = (
        ("trips.txt", "route_id", routes),
        ("stop_times.txt", "trip_id", trips),
        ("stop_times.txt", "stop_id", stops),
    )
    for name, field, known in checks:
        for row in feed[name]:
            if row[field] not in known:
                raise GtfsError(f"{name}: unknown {field} '{row[field]}'")


def _parse_date(value: str, where: str) -> date:
    try:
        return datetime.strptime(value, "%Y%m%d").date()
    except ValueError:
        raise GtfsError(f"{where}: invalid date '{value}'") from None


def feed_validity(feed: Feed) -> tuple[date, date]:
    """Return (first, last) service date from calendar rows and added dates."""
    days: list[date] = []
    for row in feed.get("calendar.txt", []):
        days.append(_parse_date(row.get("start_date", ""), "calendar.txt start_date"))
        days.append(_parse_date(row.get("end_date", ""), "calendar.txt end_date"))
    for row in feed.get("calendar_dates.txt", []):
        if row.get("exception_type") == "1":
            days.append(_parse_date(row.get("date", ""), "calendar_dates.txt date"))
    if not days:
        raise GtfsError("calendar.txt and calendar_dates.txt define no service dates")
    return min(days), max(days)


def check_expiry(valid_to: date, today: date, allow_expired: bool = False) -> bool:
    """Return True when expired and allowed; raise ExpiredFeedError when not allowed."""
    if valid_to >= today:
        return False
    if not allow_expired:
        raise ExpiredFeedError(valid_to, today)
    return True
