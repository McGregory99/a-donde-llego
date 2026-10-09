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
- [ ] T1 Headline headway = departure-weighted median of line headways (each line weighted by its departures in the
      window), so a typical departure, not a typical line id, sets the figure; keep `best_min` and `by_line`; update
      the "Cómo se calcula" i18n text and the golden stats (delegated writer).
- [ ] T2 Profile the drag at city zoom and remove the bottleneck (target >= 30 fps on the e2e machine), without
      changing the final rendered result after the drag ends (delegated writer).

## Acceptance
- Valladolid headline headway is in the 10-20 min range; mini golden updated with a test proving low-service lines
  no longer dominate.
- Drag frame time measured before/after and recorded here; final frame identical to a non-drag render.
- vitest, pytest, Playwright green.

## Delivery
`ask-on-risk`; one PR.
