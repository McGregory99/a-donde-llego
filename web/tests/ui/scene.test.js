// Scene: travel-time raster, contours and the destination trip derived from the view state.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createGrid } from '../../src/core/grid.js';
import { cityDefaults, defaultState } from '../../src/state-url.js';
import { computeScene, destinationTrip } from '../../src/ui/scene.js';

const { graph, cases } = JSON.parse(readFileSync(new URL('../golden/travel_times.json', import.meta.url), 'utf8'));
const bbox = [-4.74, 41.58, -4.6, 41.62];
const grid = createGrid(bbox, 400);
const city = cityDefaults({
  id: 'x',
  bbox,
  center: [41.6, -4.7],
  modes: { walk: { kind: 'walk' }, road: { kind: 'transit' }, rail: { kind: 'transit' } },
});
const base = { ...defaultState(city), origin: [41.6, -4.7], isochrones: [15, 30] };
const at = (lat, lon) => [lat, lon];

describe('computeScene', () => {
  it('rasterises the whole grid and one contour list per requested isochrone (R4.3, R4.4)', () => {
    const scene = computeScene(graph, grid, base);
    expect(scene.times).toHaveLength(grid.cols * grid.rows);
    expect(Object.keys(scene.contours)).toEqual(['15', '30']);
    expect(Math.min(...scene.times.filter((v) => !Number.isNaN(v)))).toBeLessThan(5);
  });

  it('turning an isochrone off drops it; none requested means no contours', () => {
    expect(Object.keys(computeScene(graph, grid, { ...base, isochrones: [45] }).contours)).toEqual(['45']);
    expect(computeScene(graph, grid, { ...base, isochrones: [] }).contours).toEqual({});
  });

  it('with every transit mode off only walking reachability remains (R4.7)', () => {
    const all = computeScene(graph, grid, base).times;
    const walkOnly = computeScene(graph, grid, { ...base, modes: [] }).times;
    const reached = (t) => t.filter((v) => !Number.isNaN(v)).length;
    expect(reached(walkOnly)).toBeLessThan(reached(all));
    expect(reached(walkOnly)).toBeGreaterThan(0);
  });

  it('arrival mode computes times to the point, which differs from departure (R4.6)', () => {
    const departure = computeScene(graph, grid, base).times;
    const arrival = computeScene(graph, grid, { ...base, direction: 'arrival' }).times;
    expect(Array.from(arrival)).not.toEqual(Array.from(departure));
  });
});

describe('destinationTrip', () => {
  const far = at(41.6, -4.627923498088196); // stop C, reached by transit from A

  it('is null without a destination', () => {
    expect(destinationTrip(graph, base)).toBeNull();
  });

  it('gives the itinerary whose total is the travel time when within the scale (R5.1, R5.3)', () => {
    const trip = destinationTrip(graph, { ...base, destination: far, scale: 120 });
    expect(trip.reachable).toBe(true);
    expect(trip.total).toBeGreaterThan(0);
    expect(trip.legs.length).toBeGreaterThan(0);
    expect(trip.path.length).toBeGreaterThan(1);
  });

  it('is unreachable beyond the scale, with no legs (R5.5)', () => {
    const trip = destinationTrip(graph, { ...base, destination: far, scale: 5 });
    expect(trip).toEqual({ reachable: false });
  });

  it('is unreachable when no path exists', () => {
    const nowhere = at(41.5, -4.5);
    expect(destinationTrip(graph, { ...base, destination: nowhere, scale: 120 })).toEqual({ reachable: false });
  });

  it('in arrival mode the trip starts at the clicked point and ends at the anchor (R5.6)', () => {
    // Lines run A -> B -> C, so arriving at C from A is the feasible direction.
    const state = { ...base, direction: 'arrival', origin: far, destination: base.origin, scale: 120 };
    const trip = destinationTrip(graph, state);
    expect(trip.reachable).toBe(true);
    expect(trip.path[0]).toEqual(base.origin);
    expect(trip.path.at(-1)).toEqual(far);
  });
});

describe('golden origins are in the fixture', () => {
  it('has cases to draw on', () => expect(cases.length).toBeGreaterThan(0));
});
