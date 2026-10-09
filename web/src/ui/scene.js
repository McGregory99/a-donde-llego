// Scene computed from the view state: the travel times, their contours and the destination trip.
// Pure (core + state only); the canvas and the panel read the result.
import { nodeTimes, streetsOf } from '../core/dijkstra.js';
import { computeGrid } from '../core/grid.js';
import { itinerary } from '../core/itinerary.js';
import { isochrones } from '../core/isochrone.js';
import { directWalkLimitM } from '../core/geo.js';
import { streetTimeGrid } from '../core/street-grid.js';

/** Walk-only: walking all the way is bounded by the time scale; with transit the walking cap stays max_access_m. */
const searchOptions = (state, walk) => ({
  enabled: state.modes,
  reverse: state.direction === 'arrival',
  directWalkM: state.modes.length ? undefined : directWalkLimitM(walk, state.scale),
});

/**
 * Straight-line walking: { times, nodes: null, contours } with minutes per grid cell (NaN unreachable) and contour
 * segments per requested isochrone. Walking along streets: { times: null, nodes, cells, contours } with minutes per
 * street node (Infinity unreachable), which the renderer paints on the street segments, minutes per grid cell derived
 * from them (`cells`, only to trace contours: no area is painted) and the isochrone lines per threshold.
 */
export function computeScene(graph, grid, state) {
  const streets = streetsOf(graph);
  if (streets) {
    const nodes = nodeTimes(graph, state.origin, searchOptions(state, graph.walk));
    const cells = streetTimeGrid(grid, streets, nodes, graph.walk);
    return { times: null, nodes, cells, contours: isochrones(grid, cells, state.isochrones) };
  }
  const times = computeGrid(grid, graph, state.origin, searchOptions(state, graph.walk));
  return { times, nodes: null, contours: isochrones(grid, times, state.isochrones) };
}

/**
 * Trip to/from the clicked point: null when none is chosen, { reachable: false } when there is no path or it
 * takes longer than the colour scale (the map shows nothing there), else { reachable: true, total, legs, path }.
 */
export function destinationTrip(graph, state) {
  if (!state.destination) return null;
  const trip = itinerary(graph, state.origin, state.destination, searchOptions(state, graph.walk));
  if (!trip || trip.total > state.scale) return { reachable: false };
  return { reachable: true, ...trip };
}

/** Contours of an existing scene for another set of thresholds (the times are not recomputed). */
export function sceneContours(graph, grid, scene, thresholds) {
  return isochrones(grid, scene.cells ?? scene.times, thresholds);
}
