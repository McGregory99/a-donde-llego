# Feature: walking-streets

## Objective
Make walking realistic and the map easier to control: walking follows the street network instead of straight-line circles, the user can pick "bus + walking" or "walking only", the arrival marker can be removed, and bus stops are drawn on the map.

## Problem
- Walking time is straight-line distance at 75 m/min, capped at `max_access_m` (1000 m). In walking-only mode the heat map is a perfect 1 km circle, which ignores streets, rivers, railways and blocks.
- Once the black arrival marker is placed there is no way to remove it.
- Stops are used by the model but not drawn, so it is hard to see why an area is reachable.

## Scope
- In: pedestrian street graph from OSM (built offline, cached like the boundary/basemap), street-based walking for walk-only reach and for access/egress/transfer legs, explicit travel-mode choice in the UI, clear-destination control, stop markers at closer zoom levels.
- Out: elevation, crossings/traffic lights, accessibility profiles, other cities' data.

## Constraints
- Multi-city and multi-mode: no city or mode literals in `pipeline/adl` or `web/src`.
- Browser computation must stay fast (target < 1 s per recompute on Valladolid) and the asset size reasonable (target < 3 MB gzipped total).
- Python model and JS client must keep agreeing (golden cross-check).
- OSM data via Overpass with the committed-cache fallback (PR #18).
- Strict TDD: `uv run --locked pytest`, `npx vitest run`, `npx playwright test`.

## Tasks
- [x] T1 Clear destination: remove the arrival marker and itinerary (close button on the itinerary panel, Escape key, clicking the marker); URL `d` param removed. Route: delegated (UI + state + tests, 3+ files).
- [x] T2 Travel-mode choice: replace the "Autobús" checkbox with an explicit "Bus + a pie" / "Solo a pie" choice, persisted in the share URL. Route: delegated together with T1 (same UI/state files).
- [x] T3 Stop markers: draw stops from `graph.json` at closer zoom levels, with the stop name on hover/tap. Route: delegated together with T1/T2.
- [ ] T4 Street walking graph (pipeline): fetch OSM pedestrian ways, build a compact walking graph per city (nodes + edges with metres), snap stops to it, cache it like `boundary`/`basemap`, emit as a build asset; Python `travel_times` uses street distances for access/egress/transfer and walk-only. Route: delegated (pipeline, 4+ files).
- [ ] T5 Street walking (client): load the walking graph, run street Dijkstra from the origin and from reached stops, sample grid cells from nearest street nodes so the heat map follows streets; keep the golden cross-check. Route: delegated (client core, 4+ files).

- [x] T6 Full-screen layout: the map fills the viewport; header/controls and the itinerary float top-left, the "En cifras" stats become a collapsible floating card (right on desktop, bottom sheet collapsed by default on phones); legend, zoom and attribution never overlap them. Route: delegated with T1-T3 (same PR A).

## Acceptance criteria
- Walk-only from Plaza Mayor produces a non-circular shape that follows streets and stops at barriers (river without bridges).
- Bus + walking times use street distances; itinerary totals still equal the heat-map value.
- The arrival marker can be removed and the URL updates.
- Stops are visible when zoomed in.
- All test suites green; deploy succeeds.

## Delivery
- Branch `feat/walking-streets` from `main`; one PR per work unit: PR A (T1–T3 UI), PR B (T4), PR C (T5).
- TDD mode: strict (sdd-init/a-donde-llego), runners above.

## Progress
- 2026-10-08: feature document created.
- 2026-10-08: T1-T3 done in commit aa1dd6a (travel choice: `travel` action over `modes`; stops hit-testing in ui/stops.js; tapping a stop shows its name AND sets the destination at the tapped point, hover shows the name on desktop). T6 done in the layout commit below (stats-card.js, overlay layout, e2e viewport/overlap checks). Verification: vitest 346 passed, pytest 145 passed, playwright 15 passed.
