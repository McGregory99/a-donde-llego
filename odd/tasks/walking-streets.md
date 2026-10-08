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
- [x] T4 Street walking graph (pipeline): fetch OSM pedestrian ways, build a compact walking graph per city (nodes + edges with metres), snap stops to it, cache it like `boundary`/`basemap`, emit as a build asset; Python `travel_times` uses street distances for access/egress/transfer and walk-only. Route: delegated (pipeline, 4+ files). Done in 835d355 (data), 372bb7b, 9f12405.
  - User decision 2026-10-08: streets always drawn; heat map painted on street segments only (no area fill). walk.json therefore carries edge shape (Douglas-Peucker 2.5 m) and road class per edge.
- [x] T5 Street walking (client): load the walking graph, run street Dijkstra from the origin and from reached stops, paint the travel time on street segments; keep the golden cross-check. Route: delegated (client core, 4+ files). Done in afd5e1c (PR B follow-ups), a86f72f (client core + streets golden), 9c01508 (street rendering, Valladolid on streets), e23e2be (street layer cache, ticks), c3c6e5f (street-node reach stats), ed5b5b1 (transform fix + renderer test).
  - User decision 2026-10-08: streets always drawn; heat map painted on street segments only (no area fill). Data contract: `walk.json` (see `adl/walkgraph.py` docstring).

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
- 2026-10-08: T1-T3 done in commit aa1dd6a (travel choice: `travel` action over `modes`; stops hit-testing in ui/stops.js; tapping a stop shows its name AND sets the destination at the tapped point, hover shows the name on desktop). T6 done in commit 1103b20 (stats-card.js, overlay layout, e2e viewport/overlap checks). Verification: vitest 346 passed, pytest 145 passed, playwright 15 passed.
- 2026-10-08: PR A merged as #19 (adds touch tooltip fix f044e14); deployed to Pages. Starting T4 on `feat/walking-streets-graph`.
- 2026-10-08: T4 done. `walk.json` (integers only: Hilbert-ordered nodes, edges once with metres, road class, simplified shape, per-stop snap) is built from the new `streets.json` OSM cache; `travel_times` walks along streets when the walk mode sets `network: "streets"` (default `straight`, so graph.json and the client golden are unchanged). Valladolid measured: 23,319 ways / 139,113 raw nodes -> 104,170 nodes, 118,717 edges, 15,925 shape points; walk.json 2.10 MB raw, 527 KB gz (all assets about 700 KB gz); streets.json cache 1.5 MB; build 4.5 s from cache; Overpass fetch 36 tiles in about 19 min when the servers were busy. Walk-only from Plaza Mayor: 1.95 km2 along streets vs 3.14 km2 circle. Verification: pytest 188 passed, vitest 348 passed, validate-cities ok.
- 2026-10-08: T5 done on `feat/walking-streets-client` (PR C). PR B review follow-ups: no `detour_factor` on street metres; the build reads the committed OSM cache by default (live Overpass only with `--refresh-osm` / `ADL_REFRESH_OSM=1`, deploy input `refresh_osm` off by default); a cache without `streets.json` still loads for straight cities; `--skip-osm` with a streets network is an error; the build test checks street transfer neighbours. Client: `core/streets.js` (typed-array graph, snapping, bounded Dijkstra), street branch in `dijkstra.js`/`itinerary.js` (walk legs carry metres and a street polyline), cross-checked against Python on a river-with-one-bridge golden (`travel_times_streets.json`). Rendering: streets always drawn (grey base by road class, footpaths dashed and only when zoomed in), travel time painted per edge (mean of its node times, 48 colour buckets, no area fill), isochrones are ticks across the streets that cross the threshold, the street layer is cached off-screen so panning is a pixel copy. Stats: reach is the share of street nodes inside the boundary within 30 min (`percent_nodes`, scope `streets`). Valladolid now uses `walk.network: "streets"`. Measured on Valladolid (104k nodes, 119k edges): `nodeTimes` 65-90 ms with the bus, 2 ms walk-only; toggle-to-painted-frame about 150 ms (bus) / 60 ms (walk); whole-city pan 60 fps (p95 16.8 ms, was 28 fps); dragging the origin about 7 fps in headless software rendering (130 ms per move: recompute plus repaint). Build 10 s from the cache. Assets: graph 40 KB, walk 543 KB, lines 77 KB, basemap 47 KB gz. Verification: pytest 205 passed, vitest 442 passed, playwright 16 passed, validate-cities ok.
