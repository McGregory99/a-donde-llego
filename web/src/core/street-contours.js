// Isochrone fronts on the street network. With streets painted instead of an area, a contour line has
// nothing to wrap around: the front is a short tick across every street that crosses the threshold, placed
// by linear interpolation between the times at the edge's two nodes. Together the ticks trace the isochrone.
import { EARTH_RADIUS_M } from './geo.js';

const TICK_HALF_M = 45;
const METRES_PER_DEGREE = (EARTH_RADIUS_M * Math.PI) / 180;

/** Tick segments [[lat, lon], [lat, lon]] per threshold: `{ [threshold]: segments }`. `times` are minutes per street node. */
export function streetContours(walk, times, thresholds) {
  const out = Object.fromEntries(thresholds.map((t) => [t, []]));
  for (let e = 0; e < walk.edges; e += 1) {
    const a = walk.edgeA[e];
    const b = walk.edgeB[e];
    const ta = times[a];
    const tb = times[b];
    if (!Number.isFinite(ta) || !Number.isFinite(tb) || ta === tb) continue;
    for (const threshold of thresholds) {
      if ((ta <= threshold) === (tb <= threshold)) continue;
      const f = (threshold - ta) / (tb - ta);
      const lat = walk.lat[a] + (walk.lat[b] - walk.lat[a]) * f;
      const lon = walk.lon[a] + (walk.lon[b] - walk.lon[a]) * f;
      const cos = Math.cos((lat * Math.PI) / 180);
      // Edge direction in metres, then its perpendicular.
      const dx = (walk.lon[b] - walk.lon[a]) * METRES_PER_DEGREE * cos;
      const dy = (walk.lat[b] - walk.lat[a]) * METRES_PER_DEGREE;
      const norm = Math.hypot(dx, dy) || 1;
      const px = -dy / norm;
      const py = dx / norm;
      const dLat = (py * TICK_HALF_M) / METRES_PER_DEGREE;
      const dLon = (px * TICK_HALF_M) / (METRES_PER_DEGREE * cos);
      out[threshold].push([[lat - dLat, lon - dLon], [lat + dLat, lon + dLon]]);
    }
  }
  return out;
}
