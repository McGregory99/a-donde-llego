# Smooth origin drag and a representative headway stat

Branch: `feat/polish-drag-headway` (from `main`). TDD: strict (vitest `npm test` in `web/`, pytest `uv run pytest` in
`pipeline/`, Playwright `npm run e2e`).

## Objective
Dragging the origin feels smooth at city zoom, and "Una línea típica pasa cada" reflects the service riders see.

## Problem
- Origin drag renders at ~7 fps at whole-city zoom.
- The headline headway is the median across lines (58 lines, each counted once). Valladolid has many lines with a
  handful of departures a day (school, night, special services: headways of 390-780 min), so the median lands on
  60 min although 20 lines run every 10-28 min.

## Tasks
- [x] T1 (299f72e code, 8da1746 golden) Headline headway = departure-weighted median of line headways (each line weighted by its departures in the
      window), so a typical departure, not a typical line id, sets the figure; keep `best_min` and `by_line`; update
      the "Cómo se calcula" i18n text and the golden stats (delegated writer).
- [x] T2 (1adadd3) Profile the drag at city zoom and remove the bottleneck (target >= 30 fps on the e2e machine), without
      changing the final rendered result after the drag ends (delegated writer).

## Acceptance
- Valladolid headline headway is in the 10-20 min range; mini golden updated with a test proving low-service lines
  no longer dominate.
- Drag frame time measured before/after and recorded here; final frame identical to a non-drag render.
- vitest, pytest, Playwright green.

## Delivery
`ask-on-risk`; one PR.

## Evidence

### T1
- Field renamed `headway.median_by_line_min` -> `headway.typical_min` (departure-weighted median of line headways,
  weight = 1 / line headway, i.e. departures in the window). Web stats card, its test and the mini golden follow;
  there is no stats JSON schema (the `schema` CI job only validates city configs). Legacy stats.json without the
  field hides the card (existing `isUsableStats` guard).
- Valladolid rebuilt locally from the committed OSM cache: `typical_min` 12.2 min (was 60.0 plain median), `best_min`
  10.4, 58 lines. Test `test_low_service_lines_do_not_dominate_the_typical_headway` (3 lines every 10 min vs 5 every
  600 min: plain median 600, weighted 10). The mini golden has three equal lines, so it only renames the field.

### T2 (Valladolid, whole-city zoom, headless Chromium 1280x800, 125 Hz synthetic pointermoves for 4 s)
Per move before: scene ~110 ms (street search from every stop ~60, street raster ~30, contours ~17), paint ~77 ms
(neutral base streets 46, coloured streets 16, rest 13).

| | draws/s | frame gap p50 | p95 |
|---|---|---|---|
| before (7de264c) | 3.9 | 230 ms | 467 ms |
| after (1adadd3) | 32.6 | 31.7 ms | 44 ms |

Changes: per-stop street walks cached per street graph (nodeTimes 68 -> 10 ms, identical results); neutral base
streets in their own off-screen layer; drag draws a draft (no raster/contours, no street casing); one applied
position per frame (latest wins). Release runs `completeScene` and a full repaint; e2e proves the canvas equals a
fresh load of the resulting link (within 0.5% anti-aliasing noise from the link's 5-decimal origin; deleting the
completion makes it fail). Contour lines and street outlines are hidden while dragging (visible trade-off).
Not covered: a destination trip is still recomputed on every drag frame.
