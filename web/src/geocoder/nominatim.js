// Nominatim reverse adapter. Its usage policy forbids autocomplete, so it is used only for
// one-shot reverse lookups (see geocoder/index.js, which also spaces the calls out).

export function reverseUrl(endpoint, lat, lon, { lang, contact } = {}) {
  const url = new URL(endpoint);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('lat', String(lat));
  url.searchParams.set('lon', String(lon));
  url.searchParams.set('zoom', '18');
  if (lang) url.searchParams.set('accept-language', lang);
  if (contact) url.searchParams.set('email', contact);
  return url.toString();
}

/** {label, lat, lon}, or null when there is no address at that point. */
export function parseReverse(payload) {
  if (!payload || typeof payload !== 'object') throw new TypeError('nominatim: bad payload');
  if (payload.error) return null;
  const lat = Number(payload.lat);
  const lon = Number(payload.lon);
  if (typeof payload.display_name !== 'string' || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new TypeError('nominatim: bad payload');
  }
  return { label: payload.display_name, lat, lon };
}
