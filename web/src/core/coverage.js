// Served area of the sampling grid, the denominator of every reach percentage.
//
// A percentage over the whole bbox is meaningless: the bbox is mostly countryside
// (only ~13% of a typical city bbox is reachable at all). The area is the cells inside
// the city boundary when the asset has one, otherwise the cells within the walking
// radius (max_access_m) of any stop. Mirrors pipeline/adl/stats.py's two scopes.
import { cellCenter, forEachCellNear } from './grid.js';
import { pointInPolygons } from './geo.js';

/** Uint8Array over the grid: 1 for cells in the served area. `boundary` is the boundary asset or null. */
export function coverageMask(grid, graph, boundary) {
  const mask = new Uint8Array(grid.cols * grid.rows);
  const polygons = boundary?.polygons ?? [];
  if (polygons.length) {
    for (let row = 0; row < grid.rows; row += 1) {
      for (let col = 0; col < grid.cols; col += 1) {
        if (pointInPolygons(polygons, cellCenter(grid, row, col))) mask[row * grid.cols + col] = 1;
      }
    }
    return mask;
  }
  for (const stop of graph.stops) {
    forEachCellNear(grid, [stop.lat, stop.lon], graph.walk.max_access_m, (index) => {
      mask[index] = 1;
    });
  }
  return mask;
}

/** Percent of covered cells reached within `maxMinutes` (NaN times never count; 0 for an empty area). */
export function reachPercent(times, mask, maxMinutes) {
  let covered = 0;
  let reached = 0;
  for (let i = 0; i < times.length; i += 1) {
    if (!mask[i]) continue;
    covered += 1;
    if (times[i] <= maxMinutes) reached += 1;
  }
  return covered ? (100 * reached) / covered : 0;
}
