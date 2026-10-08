// Static assets of a city, built offline by the pipeline (dist/data/<city>/*.json).
import { decodeWalk } from '../core/streets.js';

// The map needs the required assets; the stats panel is a bonus and the map still works without it.
export const REQUIRED_ASSETS = ['meta', 'graph', 'lines', 'boundary', 'basemap'];
export const OPTIONAL_ASSETS = ['stats'];

/** Failure with `key` = i18n key for the user-visible message. */
export class DataError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DataError';
    this.key = 'errors.dataLoad';
  }
}

/** The named assets of `cityId` as an object keyed by name; all-or-nothing. */
export async function loadCityAssets(cityId, names, { fetch = (...args) => globalThis.fetch(...args), base = './data/' } = {}) {
  const load = async (name) => {
    const url = `${base}${cityId}/${name}.json`;
    try {
      const response = await fetch(url);
      if (!response.ok) throw new DataError(`data: ${name}.json HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      throw error instanceof DataError ? error : new DataError(`data: ${name}.json: ${error?.message ?? error}`);
    }
  };
  const values = await Promise.all(names.map(load));
  return Object.fromEntries(names.map((name, i) => [name, values[i]]));
}

/**
 * The required assets of `cityId` (all-or-nothing) plus the optional ones, each `null` when it cannot be loaded.
 * A city whose walk network is "streets" also needs walk.json: it is decoded onto `graph.streets` (not returned).
 */
export async function loadCityData(cityId, options) {
  const [required, ...optional] = await Promise.all([
    loadCityAssets(cityId, REQUIRED_ASSETS, options),
    ...OPTIONAL_ASSETS.map((name) =>
      loadCityAssets(cityId, [name], options).then((assets) => assets[name], () => null),
    ),
  ]);
  if (required.graph?.walk?.network === 'streets') {
    const { walk } = await loadCityAssets(cityId, ['walk'], options);
    required.graph.streets = decodeWalk(walk);
  }
  return { ...required, ...Object.fromEntries(OPTIONAL_ASSETS.map((name, i) => [name, optional[i]])) };
}
