"""R2.3: feed validity vs build date; --allow-expired downgrades to a warning."""

import json
from datetime import date

import pytest

from adl.fetch import main
from adl.gtfs_validate import ExpiredFeedError, check_expiry

TODAY = date(2026, 10, 6)


def test_expired_feed_fails_citing_the_date():
    with pytest.raises(ExpiredFeedError, match="2026-03-20"):
        check_expiry(date(2026, 3, 20), TODAY)


def test_allow_expired_returns_true_instead_of_raising():
    assert check_expiry(date(2026, 3, 20), TODAY, allow_expired=True) is True


def test_current_feed_is_not_expired():
    assert check_expiry(date(2026, 10, 6), TODAY) is False


def _run(make_zip, tmp_path, *flags):
    zip_path = make_zip("expired_gtfs")
    out = tmp_path / "out"
    code = main(
        ["--gtfs-file", str(zip_path), "--out", str(out), "--today", "2026-10-06", *flags]
    )
    return code, out


def test_cli_expired_exits_2_and_names_the_date(make_zip, tmp_path, capsys):
    code, out = _run(make_zip, tmp_path)
    assert code == 2
    assert "2026-03-20" in capsys.readouterr().err
    assert not (out / "feed-meta.json").exists()


def test_cli_allow_expired_warns_and_records_expired(make_zip, tmp_path, capsys):
    code, out = _run(make_zip, tmp_path, "--allow-expired")
    assert code == 0
    assert "warning" in capsys.readouterr().err.lower()
    meta = json.loads((out / "feed-meta.json").read_text(encoding="utf-8"))
    assert meta["expired"] is True
    assert meta["valid_to"] == "2026-03-20"
