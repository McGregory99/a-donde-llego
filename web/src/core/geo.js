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

/** Walking minutes for `metres` along streets: already the real path, so no detour factor (see street_minutes in graph.py). */
export function streetMinutes(metres, walk) {
  return metres / walk.speed_m_per_min;
}

export const DEFAULT_MAX_SNAP_M = 150;

function inRing(point, ring) {
  const [y, x] = point;
  let inside = false;
  for (let i = 1; i < ring.length; i += 1) {
    const [y1, x1] = ring[i - 1];
    const [y2, x2] = ring[i];
    if (y1 > y !== y2 > y && x < ((x2 - x1) * (y - y1)) / (y2 - y1) + x1) inside = !inside;
  }
  return inside;
}

/** True when `point` lies in any polygon of a boundary asset ([[outer, ...holes], ...], rings of [lat, lon]). */
export function pointInPolygons(polygons, point) {
  return polygons.some(
    ([outer, ...holes]) => inRing(point, outer) && !holes.some((hole) => inRing(point, hole)),
  );
}
