// Static assets of a city, built offline by the pipeline (dist/data/<city>/*.json).

export const ASSETS = ['meta', 'graph', 'lines', 'boundary', 'basemap'];

/** Failure with `key` = i18n key for the user-visible message. */
export class DataError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DataError';
    this.key = 'errors.dataLoad';
  }
}

/** Every asset of `cityId` as `{ meta, graph, lines, boundary, basemap }`; all-or-nothing. */
export async function loadCityData(cityId, { fetch = (...args) => globalThis.fetch(...args), base = './data/' } = {}) {
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
  const values = await Promise.all(ASSETS.map(load));
  return Object.fromEntries(ASSETS.map((name, i) => [name, values[i]]));
}
