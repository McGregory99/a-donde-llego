"""R3.3, R3.5: boarding wait and walking time are pure functions of parameters."""

import pytest

from adl.graph import walk_minutes, wait_minutes

WAIT = {"factor": 0.5, "min": 1, "max": 15}
WALK = {"speed_m_per_min": 75, "detour_factor": 1.0}


@pytest.mark.parametrize(
    ("headway", "expected"),
    [(8, 4), (40, 15), (1, 1), (0.2, 1)],
)
def test_wait_is_half_headway_clamped(headway, expected):
    assert wait_minutes(headway, WAIT) == expected


def test_wait_honours_overrides():
    assert wait_minutes(40, {"factor": 0.5, "min": 2, "max": 30}) == 20
    assert wait_minutes(10, {"factor": 1.0, "min": 1, "max": 15}) == 10


def test_walk_150_m_at_75_is_two_minutes():
    assert walk_minutes(150, WALK) == 2.0


def test_walk_applies_detour_factor():
    assert walk_minutes(150, {**WALK, "detour_factor": 1.25}) == pytest.approx(2.5)
