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

  it('still loads the map when stats.json is missing: the stats asset is optional', async () => {
    const fetch = vi.fn((url) => (url.endsWith('stats.json') ? Promise.resolve({ ok: false, status: 404 }) : ok(assets[url.split('/').pop().replace('.json', '')])));
    const data = await loadCityData('x', { fetch, base: '/data/' });
    expect(data.stats).toBeNull();
    expect(data.graph).toEqual(assets.graph);
  });

  it('treats a stats.json that is not valid JSON as absent', async () => {
    const fetch = (url) =>
      url.endsWith('stats.json')
        ? Promise.resolve({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad'); } })
        : ok(assets[url.split('/').pop().replace('.json', '')]);
    expect((await loadCityData('x', { fetch })).stats).toBeNull();
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

describe('loadCityData for a city that walks along streets', () => {
  const walkAsset = { schema: 1, scale: 100000, n: 2, lat: [4160000, 10], lon: [-470000, 0], deg: [1, 0], to: [1], m: [100], cls: [1], geo: [0], glat: [], glon: [], stops: { node: [0], snap_m: [4] } };
  const streetAssets = { ...assets, graph: { stops: [{}], lines: [], walk: { network: 'streets' } }, walk: walkAsset };
  const serve = (all) => vi.fn((url) => (all[url.split('/').pop().replace('.json', '')] ? ok(all[url.split('/').pop().replace('.json', '')]) : Promise.resolve({ ok: false, status: 404 })));

  it('fetches walk.json and decodes it onto the graph', async () => {
    const data = await loadCityData('x', { fetch: serve(streetAssets), base: '/data/' });
    expect(data.graph.streets.n).toBe(2);
    expect(Array.from(data.graph.streets.stopNode)).toEqual([0]);
    expect(data.walk).toBeUndefined();
  });

  it('fails with the data error when the street graph is missing', async () => {
    const { walk, ...without } = streetAssets;
    const error = await loadCityData('x', { fetch: serve(without), base: '/data/' }).catch((e) => e);
    expect(error).toBeInstanceOf(DataError);
    expect(error.message).toMatch(/walk\.json/);
  });

  it('never asks for walk.json when the city walks in straight lines', async () => {
    const fetch = serve(assets);
    await loadCityData('x', { fetch, base: '/data/' });
    expect(fetch.mock.calls.some(([url]) => url.includes('walk'))).toBe(false);
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
