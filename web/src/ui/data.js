// Static assets of a city, built offline by the pipeline (dist/data/<city>/*.json).

export const ASSETS = ['meta', 'graph', 'lines', 'boundary', 'basemap', 'stats'];

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

/** Every asset of `cityId`; all-or-nothing. */
export const loadCityData = (cityId, options) => loadCityAssets(cityId, ASSETS, options);
