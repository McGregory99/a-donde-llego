// Geocoder adapter (R6.1-R6.6): search with a debounce and a session cache, results restricted
// to the city bbox, graceful errors carrying an i18n key. Provider, endpoints and bbox come from
// the city config; `fetch` and timers are injected so tests never touch the network.
import { parseReverse, reverseUrl } from './nominatim.js';
import { parseSearch, searchUrl } from './photon.js';

const SEARCH_PROVIDERS = { photon: { buildUrl: searchUrl, parse: parseSearch } };
const REVERSE_PROVIDERS = { nominatim: { buildUrl: reverseUrl, parse: parseReverse } };

const DEFAULTS = { debounceMs: 300, timeoutMs: 8000, cacheSize: 50, limit: 8, minChars: 3, reverseGapMs: 1000 };

/** Failure with `key` = i18n key for the user-visible message (the UI shows t(error.key), non-blocking). */
export class GeocoderError extends Error {
  constructor(key, message) {
    super(message ?? key);
    this.name = 'GeocoderError';
    this.key = key;
  }
}

const inside = ([west, south, east, north], { lat, lon }) => lat >= south && lat <= north && lon >= west && lon <= east;

function provider(table, name, role) {
  if (!Object.hasOwn(table, name)) throw new Error(`geocoder: unknown ${role} provider "${name}"`);
  return table[name];
}

export function createGeocoder(config, options = {}) {
  const settings = { ...DEFAULTS, ...options };
  const doFetch = options.fetch ?? ((...args) => globalThis.fetch(...args));
  const now = options.now ?? Date.now;
  const { bbox, locale } = config;
  const { provider: searchName, endpoint, lang, contact, reverse: reverseConfig } = config.geocoder;
  const searcher = provider(SEARCH_PROVIDERS, searchName, 'search');
  const reverser = reverseConfig ? provider(REVERSE_PROVIDERS, reverseConfig.provider, 'reverse') : null;

  async function getJson(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), settings.timeoutMs);
    try {
      const response = await doFetch(url, { signal: controller.signal });
      if (response.status === 429) throw new GeocoderError('errors.geocoderRateLimit', 'geocoder: HTTP 429');
      if (!response.ok) throw new GeocoderError('errors.geocoder', `geocoder: HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      if (error instanceof GeocoderError) throw error;
      if (error?.name === 'AbortError') throw new GeocoderError('errors.geocoderTimeout', 'geocoder: timeout');
      throw new GeocoderError('errors.geocoder', `geocoder: ${error?.message ?? error}`);
    } finally {
      clearTimeout(timer);
    }
  }

  const cache = new Map();
  const remember = (key, value) => {
    cache.set(key, value);
    if (cache.size > settings.cacheSize) cache.delete(cache.keys().next().value);
  };

  /** { results: [{label, lat, lon}], outside } for the query; results outside the bbox are excluded and counted. */
  async function search(query) {
    const text = typeof query === 'string' ? query.trim().replace(/\s+/g, ' ') : '';
    if (text.length < settings.minChars) return { results: [], outside: 0 };
    const key = text.toLowerCase();
    if (cache.has(key)) return cache.get(key);
    if (!endpoint) throw new GeocoderError('errors.geocoder', 'geocoder: no endpoint configured for search');
    const payload = await getJson(searcher.buildUrl(endpoint, text, bbox, { limit: settings.limit, lang }));
    let places;
    try {
      places = searcher.parse(payload);
    } catch (error) {
      throw new GeocoderError('errors.geocoder', `geocoder: ${error.message}`);
    }
    const seen = new Set();
    const results = places.filter((place) => {
      const id = `${place.label}|${place.lat}|${place.lon}`;
      if (seen.has(id) || !inside(bbox, place)) return false;
      seen.add(id);
      return true;
    });
    const outside = places.filter((place) => !inside(bbox, place)).length;
    const value = { results, outside };
    remember(key, value);
    return value;
  }

  let sequence = 0;
  let pending = null;
  /** Debounced search for typing: resolves null when a newer suggest superseded this one. */
  function suggest(query) {
    const mine = ++sequence;
    if (pending) {
      clearTimeout(pending.timer);
      pending.resolve(null);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending = null;
        // A superseded search resolves null whether it succeeds or fails: only the latest one may surface.
        search(query).then(
          (value) => resolve(mine === sequence ? value : null),
          (error) => (mine === sequence ? reject(error) : resolve(null)),
        );
      }, settings.debounceMs);
      pending = { timer, resolve };
    });
  }

  let nextReverseAt = 0;
  /** One-shot address for a point, or null (no address, or outside the bbox). Calls are spaced out to respect the provider policy. */
  async function reverse(lat, lon) {
    if (!reverser) throw new GeocoderError('errors.geocoder', 'geocoder: no reverse provider configured');
    if (!inside(bbox, { lat, lon })) return null;
    const wait = Math.max(0, nextReverseAt - now());
    nextReverseAt = now() + wait + settings.reverseGapMs;
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
    const payload = await getJson(reverser.buildUrl(reverseConfig.endpoint, lat, lon, { lang: locale, contact }));
    try {
      return reverser.parse(payload);
    } catch (error) {
      throw new GeocoderError('errors.geocoder', `geocoder: ${error.message}`);
    }
  }

  return { search, suggest, reverse };
}
