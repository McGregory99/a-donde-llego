// Sampling grid over the city bbox and its travel-time raster (R4.3, R4.8).
import { stopTimes } from './dijkstra.js';
import { distanceM, walkMinutes } from './geo.js';

const METRES_PER_DEGREE_LAT = 111_194.9;

/** Grid of ~`cellM` metre cells over `bbox` = [west, south, east, north]. Row 0 is the south edge. */
export function createGrid(bbox, cellM) {
  const [west, south, east, north] = bbox;
  if (!(east > west && north > south)) throw new Error(`invalid bbox: ${JSON.stringify(bbox)}`);
  if (!(cellM > 0)) throw new Error(`cell size must be positive, got ${cellM}`);
  const middle = (south + north) / 2;
  const cols = Math.ceil(distanceM([middle, west], [middle, east]) / cellM);
  const rows = Math.ceil(distanceM([south, west], [north, west]) / cellM);
  return { bbox, cellM, cols, rows, dLat: (north - south) / rows, dLon: (east - west) / cols };
}

/** Centre of a cell as [lat, lon]. */
export function cellCenter(grid, row, col) {
  const [west, south] = grid.bbox;
  return [south + (row + 0.5) * grid.dLat, west + (col + 0.5) * grid.dLon];
}

/** Calls `visit(index, distanceM)` for every cell whose centre is within `radiusM` of `anchor` ([lat, lon]). */
export function forEachCellNear(grid, anchor, radiusM, visit) {
  const [west, south] = grid.bbox;
  const radiusLat = (radiusM / METRES_PER_DEGREE_LAT) * 1.01;
  const radiusLon = radiusLat / Math.cos((anchor[0] * Math.PI) / 180);
  const rowFrom = Math.max(0, Math.floor((anchor[0] - radiusLat - south) / grid.dLat));
  const rowTo = Math.min(grid.rows - 1, Math.ceil((anchor[0] + radiusLat - south) / grid.dLat));
  const colFrom = Math.max(0, Math.floor((anchor[1] - radiusLon - west) / grid.dLon));
  const colTo = Math.min(grid.cols - 1, Math.ceil((anchor[1] + radiusLon - west) / grid.dLon));
  for (let row = rowFrom; row <= rowTo; row += 1) {
    for (let col = colFrom; col <= colTo; col += 1) {
      const d = distanceM(anchor, cellCenter(grid, row, col));
      if (d <= radiusM) visit(row * grid.cols + col, d);
    }
  }
}

/**
 * Minutes to (reverse: from) every cell centre; NaN where nothing is reachable.
 * A cell is reached by walking from the point itself or from a reachable stop,
 * within the city's walking radius, so only cells near those anchors are visited.
 */
export function computeGrid(grid, graph, point, options = {}) {
  const { walk } = graph;
  const times = new Float32Array(grid.cols * grid.rows).fill(NaN);
  const stamp = (anchor, base) =>
    forEachCellNear(grid, anchor, walk.max_access_m, (index, d) => {
      const minutes = base + walkMinutes(d, walk);
      if (!(times[index] <= minutes)) times[index] = minutes;
    });

  stamp(point, 0);
  const viaStop = stopTimes(graph, point, options);
  graph.stops.forEach((stop, i) => {
    if (viaStop[i] !== Infinity) stamp([stop.lat, stop.lon], viaStop[i]);
  });
  return times;
}
