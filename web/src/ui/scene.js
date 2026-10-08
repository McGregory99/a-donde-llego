// Scene computed from the view state: the travel-time raster, its contours and the destination trip.
// Pure (core + state only); the canvas and the panel read the result.
import { computeGrid } from '../core/grid.js';
import { itinerary } from '../core/itinerary.js';
import { isochrones } from '../core/isochrone.js';

const searchOptions = (state) => ({ enabled: state.modes, reverse: state.direction === 'arrival' });

/** { times, contours }: minutes per grid cell (NaN unreachable) and contour segments per requested isochrone. */
export function computeScene(graph, grid, state) {
  const times = computeGrid(grid, graph, state.origin, searchOptions(state));
  return { times, contours: isochrones(grid, times, state.isochrones) };
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
