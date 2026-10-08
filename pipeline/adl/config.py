"""City config loading: schema validation plus per-kind mode defaults.

Everything city- or mode-specific lives in ``cities/<id>.json``; this module
only knows the generic mode kinds ``walk`` and ``transit``.
"""

from __future__ import annotations

import copy
import json
from pathlib import Path

from jsonschema import Draft7Validator

CITIES_DIR = Path(__file__).resolve().parents[2] / "cities"

MODE_DEFAULTS = {
    "walk": {
        "speed_m_per_min": 75,
        "detour_factor": 1.0,
        "max_access_m": 1000,
        "max_transfer_walk_m": 400,
    },
    "transit": {
        "wait": {"factor": 0.5, "min": 1, "max": 15},
        "transfer_min": 1.5,
        "enabled_default": True,
    },
}


class ConfigError(Exception):
    """Raised when a city config is missing or invalid."""


def _field_path(error) -> str:
    path = ".".join(str(p) for p in error.absolute_path)
    if error.validator == "required":
        missing = error.message.split("'")[1]
        path = f"{path}.{missing}" if path else missing
    return path or "(root)"


def _apply_defaults(city: dict) -> dict:
    for mode in city["modes"].values():
        for key, value in MODE_DEFAULTS[mode["kind"]].items():
            if isinstance(value, dict):
                mode[key] = {**value, **mode.get(key, {})}
            else:
                mode.setdefault(key, value)
    return city


def load_city(city_id: str, cities_dir: Path | str | None = None) -> dict:
    """Load and validate ``<cities_dir>/<city_id>.json``, filling mode defaults."""
    base = Path(cities_dir) if cities_dir is not None else CITIES_DIR
    path = base / f"{city_id}.json"
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise ConfigError(f"{path.name}: city config not found in {base}") from None
    except json.JSONDecodeError as exc:
        raise ConfigError(f"{path.name}: invalid JSON ({exc})") from None

    schema = json.loads((CITIES_DIR / "schema.json").read_text(encoding="utf-8"))
    errors = sorted(Draft7Validator(schema).iter_errors(data), key=lambda e: list(e.absolute_path))
    if errors:
        lines = [f"{path.name}: field '{_field_path(e)}': {e.message}" for e in errors]
        raise ConfigError("\n".join(lines))
    if data["id"] != city_id:
        raise ConfigError(f"{path.name}: field 'id': must equal file name '{city_id}'")
    return _apply_defaults(copy.deepcopy(data))
