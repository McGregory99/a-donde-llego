// Shareable view state in the URL query string (R7.1-R7.5).
//
//   c=<city>  o=<lat,lon> origin  dir=departure|arrival  modes=<ids>  iso=<minutes>
//   max=<minutes> colour scale  d=<lat,lon> optional destination
//
// Parsing treats the URL as hostile: every value is validated, clamped or dropped, unknown
// parameters are ignored, and the result is always a complete valid state. `ignored` lists
// the recognised parameters that were rejected, so the UI can show an informational message.

export const DIRECTIONS = ['departure', 'arrival'];
export const ISOCHRONE_CHOICES = [15, 30, 45, 60];
export const DEFAULT_ISOCHRONES = [15, 30];
export const SCALE = { min: 5, max: 120, default: 45 };
const MAX_QUERY_LENGTH = 2048;
const NUMBER = /^-?\d{1,6}(\.\d{1,10})?$/;
const COORD_DECIMALS = 5;

/** Per-city inputs for parsing, derived from the city config (no mode or city literals here). */
export function cityDefaults(config) {
  const transit = Object.entries(config.modes).filter(([, mode]) => mode.kind === 'transit');
  return {
    id: config.id,
    bbox: [...config.bbox],
    center: [...config.center],
    modes: transit.map(([id]) => id),
    defaultModes: transit.filter(([, mode]) => mode.enabled_default !== false).map(([id]) => id),
  };
}

export function defaultState(city) {
  return {
    city: city.id,
    origin: [...city.center],
    direction: DIRECTIONS[0],
    modes: [...city.defaultModes],
    isochrones: [...DEFAULT_ISOCHRONES],
    scale: SCALE.default,
    destination: null,
  };
}

const round = (n) => Number(n.toFixed(COORD_DECIMALS));

/** "lat,lon" inside the bbox, or null. */
function parseCoordinates(text, [west, south, east, north]) {
  const parts = text.split(',');
  if (parts.length !== 2 || !parts.every((p) => NUMBER.test(p))) return null;
  const [lat, lon] = parts.map(Number);
  return lat >= south && lat <= north && lon >= west && lon <= east ? [round(lat), round(lon)] : null;
}

const tokens = (text) => text.split(',').filter((token) => token !== '');

/** Parses a query string (leading "?" allowed) into { state, ignored }; never throws. */
export function parseState(search, city) {
  const state = defaultState(city);
  const ignored = [];
  const text = search instanceof URLSearchParams ? search.toString() : typeof search === 'string' ? search : '';
  if (text.length > MAX_QUERY_LENGTH) return { state, ignored: ['query'] };
  const params = new URLSearchParams(text.startsWith('?') ? text.slice(1) : text);
  const reject = (key) => ignored.push(key);

  // Coordinates only mean something inside their own city: a link for another city keeps
  // the city-independent settings but drops (and reports) every location parameter.
  const foreign = params.has('c') && params.get('c') !== city.id;
  if (foreign) reject('c');

  for (const [key, field] of [['o', 'origin'], ['d', 'destination']]) {
    if (!params.has(key)) continue;
    const point = foreign ? null : parseCoordinates(params.get(key), city.bbox);
    if (point) state[field] = point;
    else reject(key);
  }

  if (params.has('dir')) {
    const direction = params.get('dir');
    if (DIRECTIONS.includes(direction)) state.direction = direction;
    else reject('dir');
  }

  if (params.has('max')) {
    const value = params.get('max');
    if (NUMBER.test(value)) state.scale = Math.min(SCALE.max, Math.max(SCALE.min, Math.round(Number(value))));
    else reject('max');
  }

  if (params.has('modes')) {
    const asked = tokens(params.get('modes'));
    state.modes = [...new Set(asked.filter((id) => city.modes.includes(id)))];
    if (asked.some((id) => !city.modes.includes(id))) reject('modes');
  }

  if (params.has('iso')) {
    const asked = tokens(params.get('iso'));
    const valid = ISOCHRONE_CHOICES.filter((m) => asked.includes(String(m)));
    if (valid.length || !asked.length) state.isochrones = valid;
    if (asked.length && (!valid.length || new Set(asked).size !== valid.length)) reject('iso');
  }

  return { state, ignored };
}

/** Query string (no leading "?") for a state; only the view state, no personal data. */
export function serializeState(state) {
  const params = new URLSearchParams();
  const point = ([lat, lon]) => `${round(lat)},${round(lon)}`;
  params.set('c', state.city);
  params.set('o', point(state.origin));
  params.set('dir', state.direction);
  params.set('modes', state.modes.join(','));
  params.set('iso', state.isochrones.join(','));
  params.set('max', String(state.scale));
  if (state.destination) params.set('d', point(state.destination));
  return params.toString().replace(/%2C/g, ',');
}
