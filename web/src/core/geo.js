// Pure geometry helpers shared by the travel-time core. Points are [lat, lon].
export const EARTH_RADIUS_M = 6_371_000;

const rad = (deg) => (deg * Math.PI) / 180;

/** Great-circle distance in metres (same formula as the pipeline's distance_m). */
export function distanceM(a, b) {
  const p1 = rad(a[0]);
  const p2 = rad(b[0]);
  const dLat = p2 - p1;
  const dLon = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/** Walking minutes for a straight-line distance, using the city's walk mode. */
export function walkMinutes(distance, walk) {
  return (distance * walk.detour_factor) / walk.speed_m_per_min;
}
