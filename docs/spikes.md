# Spikes S1-S3 (2026-10-07)

## S1: Upstream (camilleroux/montpellier-temps-transport)

- Pinned SHA: `8fb45be2cbaf51be6916107148969f98c441a408` (2026-10-07). License: MIT for code, Copyright (c) 2026 Camille Roux; ODbL 1.0 for computed data (see `pipeline/upstream/LICENSE`).
- Map library: none. The client is a single vanilla ES module (`site/app.js`, 1496 lines) drawing on a `<canvas>` with its own pan/zoom. The basemap is vector context (communes, water, parks, rail) precomputed from OSM. There are no raster tiles and no Leaflet or MapLibre.
- Python: stdlib only (no `requirements`/`pyproject`). Flat scripts at repo root: `fetch_data.py` (download GTFS, communes, OSM) -> `build_data.py` (graph, grid, mask -> `site/data/<city>.json`) -> `build_pages.py` (templates -> HTML), `build.py` (orchestrator), `cities.py` (config loader with defaults), `tools/`.
- Intermediate format: `data/<city>/` raw sources (git-ignored); output `site/data/<city>.json` with keys `meta, context, boroughs, water, parks, routes, routeInfo, stations, routeStates, stationStates, adjacency, cells, mask` (~7 MB per city).
- City config: flat `cities/<slug>.json` (`slug, order, name, network, metropole, epci, gtfsUrl, gtfsLicence, defaultFrom{lat,lon,label}, osmBbox, parksBbox, geocoder, ...`); `cities.py` fills defaults. France-centric: BAN geocoder by default, Photon when `country != FR`, `epci` SIREN for boundaries, tram/metro focus (bus optional).
- GTFS parsing: `utf-8-sig`, supports `calendar.txt` plus `calendar_dates.txt`.
- Not vendored: `site/data` (89 MB), generated pages, OG images, `sources/`, 25 of 27 city configs.

## S2: AUVASA GTFS feed

- Current feed found: `http://212.170.201.204:50080/GTFSRTapi/api/GTFSFile` (linked from the "Link GTFS Estatico" PDF on https://www.auvasa.es/empresa/datos-abiertos/). HTTP 200, zip, 2.6 MB, IIS. Plain HTTP on a raw IP and non-standard port.
- Contents: 54 routes (all `route_type` 3), 581 stops, 3427 trips, shapes.txt present (5.5 MB), agency AUVASA (Europe/Madrid). No `feed_info.txt`.
- Validity: `calendar.txt` has a header and zero rows; services are defined only by `calendar_dates.txt` (11448 rows, all `exception_type` 1) covering 2026-10-07 to 2026-12-27 (78 dates). Covers today (2026-10-07), about 81 days of validity.
- Parser gotchas: `calendar.txt` header has spaces after commas (`service_id, monday, ...`); calendar_dates-only services must be supported; CRLF line endings.
- License: CC BY 3.0 ES, attribution "Fuente: AUVASA" (auvasa.es open data page).
- Stops bbox: lat 41.5444-41.6914, lon -4.8397 to -4.6671.
- Other sources tried: NAP `Files/Detail/1366` returns 404; NAP root is a JS app (ApiKey needed; Mobility Database lists NAP file 1563, `authentication_type` 2); datos.gob.es API has no AUVASA dataset; Mobility Database `es-valladolid-auvasa-gtfs-2730` (`mdb-latest` mirror URL returned 404) and its API is behind a bot wall.
- Conclusion: the release gate (S2) is satisfiable today, but the URL is unversioned HTTP: pin `gtfs.sources` to it and keep fetch's expiry check; the feed expires 2026-12-27.

## S3: OSM

- Valladolid municipality: relation `348849` (admin_level 8, `ref:ine` 47186000000, wikidata Q8356). Verified via Overpass. (Relation 349001 is the province, not used.)
- Bbox of relation (S, W, N, E): 41.5231281, -4.9281803, 41.8155086, -4.6308064. Config order `[w,s,e,n]` = `[-4.9281803, 41.5231281, -4.6308064, 41.8155086]`.
- Centre (Nominatim): lat 41.62000, lon -4.72599.

## Adjustments to later tasks

- Design "keep upstream map lib / Leaflet if raster-only" does not apply: upstream has no map library and no tiles. Basemap is precomputed OSM vector context drawn on canvas. Decision needed for 12.x (tile provider/attribution in `site.json`, `R4.1`, `R9.4`): keep canvas vector basemap, or add Leaflet/MapLibre with CARTO raster tiles.
- Layout: upstream is flat (root scripts, single `app.js`, flat `cities/`). Vendored under `pipeline/upstream/` and `web/upstream/` to keep imports working; 3.x, 5.x-8.x port logic into `pipeline/adl/` and `web/src/core|ui` (splitting `app.js`) instead of "adapting in place".
- 3.2 `valladolid.json`: set `boundary.osm_relation_id` 348849 and the bbox above; `gtfs.sources` = the AUVASA URL.
- 4.x: fixtures and parser must cover calendar_dates-only feeds and space-padded headers; `--allow-expired` stays dev-only. Fetch must accept plain HTTP source.
- 13.2 NOTICE: AUVASA attribution text "Fuente: AUVASA".
- Upstream is tram/metro oriented (`RAIL_MODES`, labels, BAN geocoder); bus-only city needs mode/label generalization (covered by R1.5 no-literals test).
