"""Shared helpers: build GTFS zips from fixture directories (no network)."""

import io
import zipfile
from pathlib import Path

import pytest

FIXTURES = Path(__file__).resolve().parents[2] / "fixtures"


def zip_dir(path: Path, extra: dict[str, bytes] | None = None) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in sorted(path.glob("*.txt")):
            zf.writestr(f.name, f.read_bytes())
        for name, data in (extra or {}).items():
            zf.writestr(name, data)
    return buf.getvalue()


@pytest.fixture
def make_zip(tmp_path):
    def _make(fixture: str, name: str = "feed.zip", extra=None) -> Path:
        out = tmp_path / name
        out.write_bytes(zip_dir(FIXTURES / fixture, extra))
        return out

    return _make
