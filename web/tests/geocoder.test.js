// R6.1-R6.6: geocoder adapter. fetch and timers are injected: tests never touch the network.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGeocoder, GeocoderError } from '../src/geocoder/index.js';
import es from '../i18n/es.json';

const config = JSON.parse(readFileSync(new URL('../../cities/valladolid.json', import.meta.url), 'utf8'));
const [west, south, east, north] = config.bbox;

const feature = (name, lon, lat, extra = {}) => ({
  type: 'Feature',
  properties: { name, city: 'Ciudad', ...extra },
  geometry: { type: 'Point', coordinates: [lon, lat] },
});
const inside = (name, extra) => feature(name, (west + east) / 2, (south + north) / 2, extra);
const reply = (body, status = 200) =>
  Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body });
const collection = (...features) => ({ type: 'FeatureCollection', features });
const lookup = (key) => key.split('.').reduce((node, part) => node?.[part], es);

function setup(handler, options = {}) {
  const fetch = vi.fn(handler);
  const geocoder = createGeocoder(config, { fetch, ...options });
  return { fetch, geocoder };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('geocoder search (R6.1)', () => {
  it('queries the configured endpoint limited to the city bbox, never hardcoding either', async () => {
    const { fetch, geocoder } = setup(() => reply(collection(inside('Plaza A'))));
    const { results } = await geocoder.search('Plaza');
    const url = new URL(fetch.mock.calls[0][0]);
    expect(url.origin + url.pathname).toBe(config.geocoder.endpoint);
    expect(url.searchParams.get('q')).toBe('Plaza');
    expect(url.searchParams.get('bbox')).toBe(config.bbox.join(','));
    expect(url.searchParams.has('limit')).toBe(true);
    expect(results).toEqual([expect.objectContaining({ lat: (south + north) / 2, lon: (west + east) / 2 })]);
  });

  it('sends lang only when the city configures one (the provider rejects unsupported languages)', async () => {
    const { fetch, geocoder } = setup(() => reply(collection()));
    await geocoder.search('Plaza');
    expect(new URL(fetch.mock.calls[0][0]).searchParams.has('lang')).toBe(false);
    const withLang = { ...config, geocoder: { ...config.geocoder, lang: 'en' } };
    const f2 = vi.fn(() => reply(collection()));
    await createGeocoder(withLang, { fetch: f2 }).search('Plaza');
    expect(new URL(f2.mock.calls[0][0]).searchParams.get('lang')).toBe('en');
  });

  it('builds readable labels and drops exact duplicates', async () => {
    const a = inside('Plaza Mayor', { street: 'Calle Real', housenumber: '3', postcode: '47001', city: 'Ciudad' });
    const { geocoder } = setup(() => reply(collection(a, a)));
    const { results } = await geocoder.search('Plaza');
    expect(results).toHaveLength(1);
    expect(results[0].label).toBe('Plaza Mayor, Calle Real 3, 47001 Ciudad');
  });

  it('skips malformed features instead of failing', async () => {
    const bad = [null, {}, { geometry: { coordinates: ['x', 1] } }, { geometry: { coordinates: [1] } }, inside('Ok')];
    const { geocoder } = setup(() => reply({ features: bad }));
    expect((await geocoder.search('Plaza')).results.map((r) => r.label)).toEqual(['Ok, Ciudad']);
  });

  it('does not hit the network for blank or too short queries', async () => {
    const { fetch, geocoder } = setup(() => reply(collection()));
    for (const q of ['', '  ', 'ab', null, undefined]) expect((await geocoder.search(q)).results).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects an unknown provider at creation', () => {
    expect(() => createGeocoder({ ...config, geocoder: { provider: 'nope' } }, { fetch: vi.fn() })).toThrow(/nope/);
  });
});

describe('geocoder bbox filtering (R6.4)', () => {
  it('excludes results outside the bbox and reports how many', async () => {
    const out = feature('Lejos', east + 1, (south + north) / 2);
    const { geocoder } = setup(() => reply(collection(inside('Cerca'), out, feature('Polo', 0, 90))));
    const { results, outside } = await geocoder.search('Cerca');
    expect(results.map((r) => r.label)).toEqual(['Cerca, Ciudad']);
    expect(outside).toBe(2);
  });
});

describe('geocoder debounce (R6.2)', () => {
  it('suggest waits for the debounce delay and only the last query goes out', async () => {
    const { fetch, geocoder } = setup(() => reply(collection(inside('X'))));
    const first = geocoder.suggest('Cal');
    const second = geocoder.suggest('Calle');
    const third = geocoder.suggest('Calle Santiago');
    await vi.advanceTimersByTimeAsync(299);
    expect(fetch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(new URL(fetch.mock.calls[0][0]).searchParams.get('q')).toBe('Calle Santiago');
    expect(await first).toBeNull();
    expect(await second).toBeNull();
    expect((await third).results).toHaveLength(1);
  });

  it('the delay is configurable', async () => {
    const { fetch, geocoder } = setup(() => reply(collection()), { debounceMs: 50 });
    geocoder.suggest('Calle');
    await vi.advanceTimersByTimeAsync(50);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('a response that arrives after a newer suggest is discarded', async () => {
    let release;
    const { geocoder } = setup((url) =>
      new URL(url).searchParams.get('q') === 'Calle uno' ? new Promise((r) => (release = r)) : reply(collection(inside('B'))),
    );
    const slow = geocoder.suggest('Calle uno');
    await vi.advanceTimersByTimeAsync(300);
    const fast = geocoder.suggest('Calle dos');
    await vi.advanceTimersByTimeAsync(300);
    release({ ok: true, status: 200, json: async () => collection(inside('A')) });
    expect(await slow).toBeNull();
    expect((await fast).results[0].label).toBe('B, Ciudad');
  });
});

describe('geocoder stale failures (R6.6)', () => {
  it('a superseded suggest whose request fails resolves null instead of surfacing the error', async () => {
    let fail;
    const { geocoder } = setup((url) =>
      new URL(url).searchParams.get('q') === 'Calle uno' ? new Promise((_, reject) => (fail = reject)) : reply(collection(inside('B'))),
    );
    const slow = geocoder.suggest('Calle uno');
    await vi.advanceTimersByTimeAsync(300);
    const fast = geocoder.suggest('Calle dos');
    await vi.advanceTimersByTimeAsync(300);
    fail(new Error('network down'));
    expect(await slow).toBeNull();
    expect((await fast).results).toHaveLength(1);
  });

  it('the latest suggest still surfaces its own failure', async () => {
    const { geocoder } = setup(() => reply({}, 500));
    const only = geocoder.suggest('Calle uno');
    const assertion = expect(only).rejects.toMatchObject({ key: 'errors.geocoder' });
    await vi.advanceTimersByTimeAsync(300);
    await assertion;
  });
});

describe('geocoder request building', () => {
  it('a missing endpoint raises a typed GeocoderError instead of a TypeError', async () => {
    const { endpoint, ...rest } = config.geocoder;
    const geocoder = createGeocoder({ ...config, geocoder: rest }, { fetch: vi.fn() });
    const error = await geocoder.search('Plaza').catch((e) => e);
    expect(error).toBeInstanceOf(GeocoderError);
    expect(error.key).toBe('errors.geocoder');
    expect(error.message).toMatch(/endpoint/);
  });
});

describe('geocoder cache (R6.2)', () => {
  it('repeats of a query (any case or spacing) are served from memory', async () => {
    const { fetch, geocoder } = setup(() => reply(collection(inside('X'))));
    const a = await geocoder.search('Plaza Mayor');
    const b = await geocoder.search('  plaza   MAYOR ');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(b).toEqual(a);
  });

  it('failures are never cached', async () => {
    let calls = 0;
    const { geocoder } = setup(() => (calls++ === 0 ? reply({}, 500) : reply(collection(inside('X')))));
    await expect(geocoder.search('Plaza')).rejects.toBeInstanceOf(GeocoderError);
    expect((await geocoder.search('Plaza')).results).toHaveLength(1);
  });

  it('the cache is bounded', async () => {
    const { fetch, geocoder } = setup(() => reply(collection(inside('X'))), { cacheSize: 2 });
    for (const q of ['aaa', 'bbb', 'ccc']) await geocoder.search(q);
    await geocoder.search('aaa');
    expect(fetch).toHaveBeenCalledTimes(4);
  });
});

describe('geocoder failures (R6.6)', () => {
  const failure = async (handler, options) => {
    const { geocoder } = setup(handler, options);
    const caught = geocoder.search('Plaza').catch((error) => error);
    await vi.advanceTimersByTimeAsync(60000);
    return caught;
  };

  it('HTTP 429 becomes a rate-limit error with a translatable key', async () => {
    const error = await failure(() => reply({}, 429));
    expect(error).toBeInstanceOf(GeocoderError);
    expect(error.key).toBe('errors.geocoderRateLimit');
  });

  it('other HTTP errors, network failures and bad payloads use the generic key', async () => {
    for (const handler of [
      () => reply({}, 503),
      () => Promise.reject(new TypeError('Failed to fetch')),
      () => Promise.resolve({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad'); } }),
      () => reply({ nothing: true }),
    ]) {
      expect((await failure(handler)).key).toBe('errors.geocoder');
    }
  });

  it('a request that never answers times out and is aborted', async () => {
    let signal;
    const error = await failure((url, init) => {
      signal = init.signal;
      return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('x', 'AbortError'))));
    });
    expect(error.key).toBe('errors.geocoderTimeout');
    expect(signal.aborted).toBe(true);
  });

  it('every error key exists in the Spanish resources', () => {
    for (const key of ['errors.geocoder', 'errors.geocoderRateLimit', 'errors.geocoderTimeout', 'controls.noResults', 'controls.resultsOutside']) {
      expect(typeof lookup(key), key).toBe('string');
    }
  });
});

describe('geocoder reverse lookup (one-shot, never autocomplete)', () => {
  const place = { display_name: 'Calle Real 3, Ciudad', lat: '41.6523', lon: '-4.7245' };

  it('asks the configured reverse endpoint for the point and returns a label', async () => {
    const { fetch, geocoder } = setup(() => reply(place));
    const found = await geocoder.reverse(41.6523, -4.7245);
    const url = new URL(fetch.mock.calls[0][0]);
    expect(url.origin + url.pathname).toBe(config.geocoder.reverse.endpoint);
    expect(url.searchParams.get('lat')).toBe('41.6523');
    expect(url.searchParams.get('lon')).toBe('-4.7245');
    expect(url.searchParams.get('format')).toBe('jsonv2');
    expect(url.searchParams.get('accept-language')).toBe(config.locale);
    expect(found).toEqual({ label: 'Calle Real 3, Ciudad', lat: 41.6523, lon: -4.7245 });
  });

  it('identifies the app with the configured contact address when there is one', async () => {
    const withContact = { ...config, geocoder: { ...config.geocoder, contact: 'hola@example.org' } };
    const fetch = vi.fn(() => reply(place));
    await createGeocoder(withContact, { fetch }).reverse(41.6523, -4.7245);
    expect(new URL(fetch.mock.calls[0][0]).searchParams.get('email')).toBe('hola@example.org');
  });

  it('returns null for a point with no address or outside the bbox, without calling out for the latter', async () => {
    const { fetch, geocoder } = setup(() => reply({ error: 'Unable to geocode' }));
    expect(await geocoder.reverse(41.6523, -4.7245)).toBeNull();
    fetch.mockClear();
    expect(await geocoder.reverse(0, 0)).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('spaces reverse calls at least one second apart', async () => {
    const { fetch, geocoder } = setup(() => reply(place));
    await geocoder.reverse(41.6523, -4.7245);
    const second = geocoder.reverse(41.6524, -4.7245);
    await vi.advanceTimersByTimeAsync(999);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await second;
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('is unavailable (clear error) when the city configures no reverse provider', async () => {
    const bare = { ...config, geocoder: { provider: config.geocoder.provider, endpoint: config.geocoder.endpoint } };
    await expect(createGeocoder(bare, { fetch: vi.fn() }).reverse(41.6523, -4.7245)).rejects.toMatchObject({ key: 'errors.geocoder' });
  });

  it('maps 429 to the rate-limit key', async () => {
    const { geocoder } = setup(() => reply({}, 429));
    await expect(geocoder.reverse(41.6523, -4.7245)).rejects.toMatchObject({ key: 'errors.geocoderRateLimit' });
  });
});
