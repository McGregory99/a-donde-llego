"""Fetch the city's GTFS, validate it and check expiry (R2.1, R2.3).

Usage: python -m adl.fetch [CITY] --out DIR [--gtfs-file ZIP] [--allow-expired]
Exit codes: 0 ok, 1 fetch/validation failure, 2 feed expired.
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
import tempfile
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from urllib.request import urlopen

from adl.config import ConfigError, load_city
from adl.gtfs_validate import (
    MAX_ZIP_BYTES,
    ExpiredFeedError,
    GtfsError,
    check_expiry,
    feed_validity,
    read_feed,
    validate_feed,
)

TIMEOUT_S = 60
CHUNK = 64 * 1024


class FetchError(Exception):
    """No usable feed could be obtained."""


@dataclass(frozen=True)
class FeedResult:
    path: Path
    source: str
    valid_from: date
    valid_to: date
    expired: bool

    def metadata(self) -> dict:
        return {
            "source": self.source,
            "valid_from": self.valid_from.isoformat(),
            "valid_to": self.valid_to.isoformat(),
            "expired": self.expired,
        }


def _download(url: str, dest: Path, opener, max_bytes: int) -> None:
    with opener(url, timeout=TIMEOUT_S) as resp:
        declared = resp.headers.get("Content-Length")
        if declared is not None and int(declared) > max_bytes:
            raise FetchError(f"{url}: declared size {declared} exceeds limit {max_bytes}")
        size = 0
        with dest.open("wb") as out:
            while chunk := resp.read(CHUNK):
                size += len(chunk)
                if size > max_bytes:
                    raise FetchError(f"{url}: download exceeds limit {max_bytes} bytes")
                out.write(chunk)


def _inspect(path: Path, max_bytes: int):
    feed = read_feed(path, max_bytes)
    validate_feed(feed)
    return feed_validity(feed)


def fetch_gtfs(
    sources: list[str],
    out_dir: Path | str,
    today: date,
    *,
    gtfs_file: Path | str | None = None,
    allow_expired: bool = False,
    opener=urlopen,
    max_bytes: int = MAX_ZIP_BYTES,
) -> FeedResult:
    """Return the first source whose calendar covers ``today``.

    With ``gtfs_file`` the network is skipped. If no source covers today and
    ``allow_expired`` is set, the first valid (expired) feed is used instead.
    """
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    final = out_dir / "gtfs.zip"
    candidates = [str(gtfs_file)] if gtfs_file is not None else list(sources)
    if not candidates:
        raise FetchError("no GTFS source configured")

    errors: list[str] = []
    expired: list[ExpiredFeedError] = []
    fallback: tuple[Path, str, date, date] | None = None
    with tempfile.TemporaryDirectory(dir=out_dir) as tmp:
        for i, source in enumerate(candidates):
            path = Path(tmp) / f"{i}.zip"
            try:
                if gtfs_file is not None:
                    shutil.copyfile(source, path)
                else:
                    _download(source, path, opener, max_bytes)
                valid_from, valid_to = _inspect(path, max_bytes)
                if valid_from > today:
                    raise GtfsError(f"feed not valid before {valid_from.isoformat()}")
                check_expiry(valid_to, today)
            except ExpiredFeedError as exc:
                expired.append(exc)
                errors.append(f"{source}: {exc}")
                if fallback is None:
                    fallback = (path, source, valid_from, valid_to)
                continue
            except (FetchError, GtfsError, OSError) as exc:
                errors.append(f"{source}: {exc}")
                continue
            shutil.move(path, final)
            return FeedResult(final, source, valid_from, valid_to, False)

        if allow_expired and fallback is not None:
            path, source, valid_from, valid_to = fallback
            shutil.move(path, final)
            return FeedResult(final, source, valid_from, valid_to, True)
    if expired and len(expired) == len(errors):
        raise expired[0]
    raise FetchError("no usable GTFS source:\n" + "\n".join(errors))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="adl.fetch")
    parser.add_argument("city", nargs="?", help="city id (cities/<id>.json)")
    parser.add_argument("--out", required=True, help="output directory")
    parser.add_argument("--gtfs-file", help="use a local GTFS zip instead of downloading")
    parser.add_argument("--allow-expired", action="store_true", help="dev only: warn on expired feeds")
    parser.add_argument("--cities-dir")
    parser.add_argument("--today", help="override build date (YYYY-MM-DD)")
    args = parser.parse_args(argv)

    today = date.fromisoformat(args.today) if args.today else date.today()
    sources: list[str] = []
    try:
        if args.city:
            sources = load_city(args.city, args.cities_dir)["gtfs"]["sources"]
        elif not args.gtfs_file:
            parser.error("a city id or --gtfs-file is required")
        result = fetch_gtfs(
            sources, args.out, today, gtfs_file=args.gtfs_file, allow_expired=args.allow_expired
        )
    except ExpiredFeedError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    except (ConfigError, FetchError, GtfsError, OSError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    if result.expired:
        print(
            f"warning: feed expired on {result.valid_to.isoformat()}; "
            "continuing because --allow-expired was given",
            file=sys.stderr,
        )
    meta = {**result.metadata(), "fetched_on": today.isoformat()}
    (Path(args.out) / "feed-meta.json").write_text(
        json.dumps(meta, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
