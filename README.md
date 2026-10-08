# A dónde llego

A travel-time map for public transport. Pick a point and see, as a heat map with isochrones, how far you can get by bus plus walking within a given time, or from where you could arrive. Live site: https://mcgregory99.github.io/a-donde-llego/ (Spanish UI, Valladolid first).

Everything runs in the browser from static files. An offline pipeline turns a city's GTFS feed and OpenStreetMap data into JSON; there is no server and no map tile provider.

## Credits

The map and its travel-time model are based on [À portée de tram](https://github.com/camilleroux/montpellier-temps-transport) by Camille Roux (MIT), pinned at the commit recorded in [UPSTREAM.md](UPSTREAM.md). Full third-party notices are in [NOTICE](NOTICE) and on the in-app "Acerca de" page.

## Data licenses

| Data | Source | License |
|---|---|---|
| Valladolid schedules (GTFS) | [AUVASA](https://www.auvasa.es/empresa/datos-abiertos/) | CC BY 3.0 ES ("Fuente: AUVASA") |
| Basemap, municipal boundary, line geometry fallback | OpenStreetMap contributors | ODbL 1.0 |
| Address search | Photon (Komoot), Nominatim; queried live from the browser | Based on OpenStreetMap data (ODbL) |

Code: MIT, see [LICENSE](LICENSE).

## Development

Requires Node 22+ and [uv](https://docs.astral.sh/uv/) (Python 3.12).

```sh
npm ci && uv sync --locked

# Build the data for a city into dist/data/<city>/ (downloads the feed and OSM data)
PYTHONPATH=pipeline uv run --locked python -m adl.build valladolid
# Offline variants: --gtfs-file feed.zip --skip-osm; --allow-expired is for local work only
# If Overpass is down the build falls back to the committed cache in cities/osm-cache/<city>/
# (meta.json records "osm": {"source": "live" | "cache" | "skipped"}). Refresh it from live Overpass and commit:
PYTHONPATH=pipeline uv run --locked python -m adl.osm_cache valladolid
# The cache also holds the pedestrian ways (streets.json) behind dist/data/<city>/walk.json, the street graph
# (nodes, edges with metres, shape and road class). A walk mode with "network": "streets" walks along it.

npx vite                         # dev server (serves dist/data under /data)
npx vitest run                   # web unit tests
uv run --locked pytest           # pipeline tests
node scripts/validate-cities.mjs # city configs against cities/schema.json
npx playwright test              # e2e: builds a fixture city, then vite build + preview under /a-donde-llego/
```

First e2e run on a machine: `npx playwright install chromium`.

## Add a city

1. Copy `cities/valladolid.json` to `cities/<id>.json` and edit it: bbox, centre, GTFS source URLs and license, attribution, modes, reference time window, optional OSM boundary relation. `cities/schema.json` documents every field; `node scripts/validate-cities.mjs` checks it.
2. Build and look at it: `PYTHONPATH=pipeline uv run --locked python -m adl.build <id>`, then `npx vite` and open `/?c=<id>`.
3. Nothing else: the site bundles every `cities/*.json`, the deploy workflow builds every city, and credits come from the config. Pipeline and client contain no city or mode literals.

## Deploy and release gate

`.github/workflows/deploy.yml` publishes to GitHub Pages from `main` on every push, weekly (so feeds are re-fetched) and on demand. It builds the data for every city, runs the release gate, builds the site with base path `/a-donde-llego/` (`ADL_BASE`) and deploys. A failing step never deploys; the previous version stays online.

The release gate blocks publishing an expired timetable:

- `adl.build` exits with an error for an expired feed. The workflow never passes `--allow-expired` (a test guards this).
- `scripts/release-gate.mjs` then checks every `cities/*.json`: its `meta.json` must exist and its feed must not be flagged expired nor end before today.

If the gate fails, the feed provider has stopped publishing a current feed: confirm the source URL in the city config and re-run once a current feed is available. Run it locally with `node scripts/release-gate.mjs` after a build.
