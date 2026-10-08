# Upstream

This project starts from an import of a third-party project and adapts it in later commits.

| Field | Value |
|---|---|
| Repository | https://github.com/camilleroux/montpellier-temps-transport |
| Pinned commit | `8fb45be2cbaf51be6916107148969f98c441a408` (2026-10-07) |
| Vendored on | 2026-10-07 |
| License | MIT for code (Copyright (c) 2026 Camille Roux); ODbL 1.0 for upstream computed data (not vendored) |

The upstream `LICENSE` is kept verbatim in `pipeline/upstream/LICENSE` and `web/upstream/LICENSE`.

## What is vendored

Code and templates only, at their upstream-relative paths:

- `pipeline/upstream/`: `build.py`, `build_data.py`, `build_pages.py`, `cities.py`, `fetch_data.py`, `tools/`, `README.md`, and two sample city configs (`cities/montpellier.json`, `cities/bruxelles.json`).
- `web/upstream/`: `site/app.js`, `site/styles.css`, `site/favicon.svg`, `site/404.html`, `templates/`.

## What is not vendored

Computed data (`site/data/`, 89 MB), generated pages (`site/<city>/`, `site/classements/`), preview images (`site/og/`), per-city provenance (`sources/`), the other 25 city configs, and the upstream Pages workflow.
