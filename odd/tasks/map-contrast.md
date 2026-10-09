# Map contrast and isochrone lines

Branch: `feat/map-contrast` (from `main`). TDD: strict (vitest `npm test` in `web/`, pytest `uv run pytest` in `pipeline/`, Playwright `npm run e2e`).

## Objective
Make the heat map readable: closed isochrone lines instead of perpendicular ticks, a high-contrast colour ramp, and
isochrone checkboxes that mean something in walk-only mode.

## Problem
- Black perpendicular ticks fragmented the isochrones in bus mode and vanished at city zoom.
- Street colours lacked contrast against the basemap.
- In "Solo a pie" walking was capped by `walk.max_access_m` (1000 m, ~13 min), so the 30/45/60 lines collapsed onto
  the 15 line and the checkboxes looked dead.

## Tasks
- [x] T1 Closed isochrone lines from a street-derived time grid, both modes, every zoom (`1d0e9cc`, delegated writer).
- [x] T2 Three candidate ramps, casing, neutral route lines, lighter basemap (`5bb629b`, delegated writer).
- [x] T3 Keep ramp B (user choice 2026-10-09): drop A, C and the dev `?ramp=` override (`72f486e`). `ramps.js` now
      exports a single `RAMP`; ramp tests apply to B. vitest 448 passed.
- [x] T4 Walk-only reach bounded by the time scale, not `max_access_m` (`059f733`). Design: new option `directWalkM`
      (JS `travelTimes`/`nodeTimes`/`itinerary`/`computeGrid`) and `direct_walk_m` (Python `travel_times`/`node_times`);
      effective cap `max(max_access_m, directWalkM)` applies only to walking all the way from the origin, stop access
      and transfers keep `max_access_m`. `computeScene` passes `directWalkLimitM(walk, state.scale)` only when no
      transit mode is enabled; the app recomputes the scene when the scale moves in walk-only. Goldens: transit cases
      byte-identical, extra walk-only cases appended with `direct_walk_m`.
      Evidence: vitest 479 passed, pytest 209 passed, Playwright 20 passed; 104k-node Valladolid street graph at
      60 min (4.5 km): nodeTimes 4 ms, street grid 32 ms, contours 164 ms (~200 ms total); 2.5 km point = 34.0 min
      in both nodeTimes and itinerary. e2e toggles the walk-only 15/30/45 lines; screenshots in scratchpad
      (`final-B-walk-city.png`, `final-B-bus-city.png`).

## Acceptance
- Only ramp B ships; tests assert its stops.
- Walk-only: a point ~2.5 km away by street is reachable (~33 min) and the 15/30/45 lines are distinct.
- Bus + walk results unchanged (goldens for transit cases identical).
- vitest, pytest, Playwright green.

## Delivery
`ask-on-risk`; one PR for the branch.
