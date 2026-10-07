// Photon (OSM-based, autocomplete-friendly) search adapter. Pure: builds the request URL and
// parses the GeoJSON reply; the network belongs to geocoder/index.js.

/** Search URL limited to `bbox` = [west, south, east, north]. `lang` is optional: Photon rejects languages it does not support. */
export function searchUrl(endpoint, query, bbox, { limit, lang } = {}) {
  const url = new URL(endpoint);
  url.searchParams.set('q', query);
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('bbox', bbox.join(','));
  if (lang) url.searchParams.set('lang', lang);
  return url.toString();
}

function labelOf(properties) {
  const street = [properties.street, properties.housenumber].filter(Boolean).join(' ');
  const town = [properties.postcode, properties.city || properties.town || properties.village].filter(Boolean).join(' ');
  return [properties.name, street, town].filter(Boolean).join(', ');
}

/** [{label, lat, lon}] from a Photon FeatureCollection; malformed features are skipped. Throws on a payload without `features`. */
export function parseSearch(payload) {
  if (!payload || !Array.isArray(payload.features)) throw new TypeError('photon: no features');
  const places = [];
  for (const feature of payload.features) {
    const [lon, lat] = feature?.geometry?.coordinates ?? [];
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    const label = labelOf(feature.properties ?? {});
    if (label) places.push({ label, lat, lon });
  }
  return places;
}
