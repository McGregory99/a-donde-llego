// Scene computed from the view state: the travel times, their contours and the destination trip.
// Pure (core + state only); the canvas and the panel read the result.
import { nodeTimes, streetsOf } from '../core/dijkstra.js';
import { computeGrid } from '../core/grid.js';
import { itinerary } from '../core/itinerary.js';
import { isochrones } from '../core/isochrone.js';
import { streetContours } from '../core/street-contours.js';

const searchOptions = (state) => ({ enabled: state.modes, reverse: state.direction === 'arrival' });

/**
 * Straight-line walking: { times, nodes: null, contours } with minutes per grid cell (NaN unreachable) and contour
 * segments per requested isochrone. Walking along streets: { times: null, nodes, contours } with minutes per street
 * node (Infinity unreachable), which the renderer paints on the street segments, and an isochrone front per threshold.
 */
export function computeScene(graph, grid, state) {
  const streets = streetsOf(graph);
  if (streets) {
    const nodes = nodeTimes(graph, state.origin, searchOptions(state));
    return { times: null, nodes, contours: streetContours(streets, nodes, state.isochrones) };
  }
  const times = computeGrid(grid, graph, state.origin, searchOptions(state));
  return { times, nodes: null, contours: isochrones(grid, times, state.isochrones) };
}

/**
 * Trip to/from the clicked point: null when none is chosen, { reachable: false } when there is no path or it
 * takes longer than the colour scale (the map shows nothing there), else { reachable: true, total, legs, path }.
 */
export function destinationTrip(graph, state) {
  if (!state.destination) return null;
  const trip = itinerary(graph, state.origin, state.destination, searchOptions(state));
  if (!trip || trip.total > state.scale) return { reachable: false };
  return { reachable: true, ...trip };
}

/** Contours of an existing scene for another set of thresholds (the times are not recomputed). */
export function sceneContours(graph, grid, scene, thresholds) {
  return scene.nodes ? streetContours(graph.streets, scene.nodes, thresholds) : isochrones(grid, scene.times, thresholds);
}
