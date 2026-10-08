"""Builds the e2e data set: the Valladolid city config (OSM data from the committed cache) over the tiny committed GTFS fixture, no network.

Usage (repo root): PYTHONPATH=pipeline uv run --locked python e2e/build_fixture.py [OUT]
OUT defaults to dist-e2e/data. The build date is fixed so the run never depends on the clock.
"""

import sys
import tempfile
import zipfile
from pathlib import Path

from adl.build import main

ROOT = Path(__file__).resolve().parents[1]
FEED_DIR = ROOT / "fixtures" / "mini_gtfs"
BUILD_DATE = "2026-10-07"


def zip_feed(directory: Path, target: Path) -> Path:
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as archive:
        for member in sorted(directory.glob("*.txt")):
            archive.write(member, member.name)
    return target


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else str(ROOT / "dist-e2e" / "data")
    with tempfile.TemporaryDirectory() as tmp:
        feed = zip_feed(FEED_DIR, Path(tmp) / "mini_gtfs.zip")
        sys.exit(main(["valladolid", "--gtfs-file", str(feed), "--out", out, "--today", BUILD_DATE]))
