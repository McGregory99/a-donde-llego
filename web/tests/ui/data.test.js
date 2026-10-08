// Loading the static assets of a city (R2.6, R4.10); fetch is injected, tests never touch the network.
import { describe, expect, it, vi } from 'vitest';
import { DataError, loadCityAssets, loadCityData } from '../../src/ui/data.js';

const assets = {
  meta: { city: { id: 'x' } },
  graph: { stops: [], lines: [] },
  lines: { lines: [] },
  boundary: { polygons: [] },
  basemap: { water: [], parks: [] },
  stats: { stops: 0 },
};
const ok = (body) => Promise.resolve({ ok: true, status: 200, json: async () => body });

describe('loadCityData', () => {
  it('fetches every asset of the city under the data base and returns them by name', async () => {
    const fetch = vi.fn((url) => ok(assets[url.split('/').pop().replace('.json', '')]));
    const data = await loadCityData('x', { fetch, base: '/data/' });
    expect(data).toEqual(assets);
    expect(fetch.mock.calls.map(([url]) => url).sort()).toEqual(
      Object.keys(assets).map((name) => `/data/x/${name}.json`).sort(),
    );
  });

  it('fails with a typed error carrying the i18n key when an asset is missing', async () => {
    const fetch = vi.fn((url) => (url.endsWith('graph.json') ? Promise.resolve({ ok: false, status: 404 }) : ok({})));
    const error = await loadCityData('x', { fetch }).catch((e) => e);
    expect(error).toBeInstanceOf(DataError);
    expect(error.key).toBe('errors.dataLoad');
    expect(error.message).toMatch(/graph\.json.*404/);
  });

  it('wraps network and JSON failures the same way', async () => {
    const network = await loadCityData('x', { fetch: () => Promise.reject(new Error('offline')) }).catch((e) => e);
    expect(network).toBeInstanceOf(DataError);
    const badJson = await loadCityData('x', {
      fetch: () => Promise.resolve({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad'); } }),
    }).catch((e) => e);
    expect(badJson).toBeInstanceOf(DataError);
  });
});

describe('loadCityAssets', () => {
  it('fetches only the named assets (the about page needs just meta)', async () => {
    const fetch = vi.fn((url) => ok(assets[url.split('/').pop().replace('.json', '')]));
    const loaded = await loadCityAssets('x', ['meta'], { fetch, base: '/data/' });
    expect(loaded).toEqual({ meta: assets.meta });
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(['/data/x/meta.json']);
  });
});
