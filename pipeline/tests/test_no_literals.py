"""R1.5: no city- or mode-specific literals in product code."""

import re
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
# Product code only: vendored upstream, config, and translations are exempt.
SCAN_DIRS = [REPO / "pipeline" / "adl", REPO / "web" / "src"]
EXEMPT = {REPO / "pipeline" / "adl" / "config.py"}
FORBIDDEN = re.compile(r"\b(valladolid|auvasa|bus|buses|autob[uú]s)\b", re.IGNORECASE)
EXTENSIONS = {".py", ".js", ".mjs", ".html", ".css"}


def product_files(scan_dirs=SCAN_DIRS):
    for base in scan_dirs:
        if not base.exists():
            continue
        for path in base.rglob("*"):
            if path.suffix in EXTENSIONS and path not in EXEMPT and "i18n" not in path.parts:
                yield path


def test_no_city_or_mode_literals_in_product_code():
    hits = [
        f"{path.relative_to(REPO)}:{n}: {line.strip()}"
        for path in product_files()
        for n, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1)
        if FORBIDDEN.search(line)
    ]
    assert not hits, "city/mode literals found:\n" + "\n".join(hits)


def test_scanner_detects_literals(tmp_path):
    sample = tmp_path / "x.py"
    sample.write_text('city = "Valladolid"\nmode = "bus"\n', encoding="utf-8")
    assert list(product_files([tmp_path])) == [sample]
    assert all(FORBIDDEN.search(line) for line in sample.read_text().splitlines())
