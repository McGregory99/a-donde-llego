// Travel-time raster from street node times. The streets carry the times, but an isochrone is a region: each grid
// cell takes the best node within the snap radius, that node's time plus the straight walk to it. Contours then
// come from the same smoothing + marching squares as an area map, so they are smooth closed lines in any mode.
import { forEachCellNear } from './grid.js';
import { walkMinutes } from './geo.js';
import { maxSnapOf } from './dijkstra.js';

/** Nodes slower than this (minutes) cannot sit on a drawn isochrone, so they are not stamped. */
export const DEFAULT_TIME_CAP = 70;

/**
 * Minutes per grid cell (NaN where no street node is within the snap radius).
 * `times` = minutes per node of `streets` (Infinity unreachable), `walk` = the city's walking parameters.
 */
export function streetTimeGrid(grid, streets, times, walk, cap = DEFAULT_TIME_CAP) {
  const raster = new Float32Array(grid.cols * grid.rows).fill(NaN);
  const radius = maxSnapOf(walk);
  for (let node = 0; node < streets.n; node += 1) {
    const base = times[node];
    if (!(base <= cap)) continue;
    forEachCellNear(grid, [streets.lat[node], streets.lon[node]], radius, (index, d) => {
      const minutes = base + walkMinutes(d, walk);
      if (!(raster[index] <= minutes)) raster[index] = minutes;
    });
  }
  return raster;
}
