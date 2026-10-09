// Walking all the way is bounded by the time scale (directWalkM), not by max_access_m; walking to a stop is not.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { nodeTimes, travelTimes } from '../../src/core/dijkstra.js';
import { directWalkLimitM } from '../../src/core/geo.js';
import { itinerary } from '../../src/core/itinerary.js';
import { createGrid } from '../../src/core/grid.js';
import { decodeWalk } from '../../src/core/streets.js';
import { cityDefaults, defaultState } from '../../src/state-url.js';
import { computeScene, destinationTrip } from '../../src/ui/scene.js';

const golden = JSON.parse(readFileSync(new URL('../golden/travel_times_streets.json', import.meta.url), 'utf8'));
const graph = { ...golden.graph, streets: decodeWalk(golden.walk) };
const { walk } = graph;
const EPS = 1e-6;

const origin = golden.cases[0].origin;

describe('directWalkLimitM', () => {
  it('turns a minute scale into metres of walking, with the detour only for straight-line walking', () => {
    expect(directWalkLimitM({ ...walk, network: 'streets' }, 45)).toBe(45 * walk.speed_m_per_min);
    expect(directWalkLimitM({ ...walk, network: 'straight', detour_factor: 1.5 }, 45)).toBe((45 * walk.speed_m_per_min) / 1.5);
  });
});

describe('walk-only beyond max_access_m', () => {
  const extended = golden.cases.find((c) => c.direct_walk_m && c.origin[0] === origin[0] && c.origin[1] === origin[1]);
  const capped = golden.cases.find((c) => c.enabled?.length === 0 && !c.direct_walk_m && c.origin[0] === origin[0]);

  it('reaches points the capped walk cannot, at their street time, in travelTimes and itinerary alike', () => {
    const gained = golden.points.map((_, i) => i).filter((i) => extended.times[i] !== null && capped.times[i] === null);
    expect(gained.length).toBeGreaterThan(3);
    gained.forEach((i) => {
      const trip = itinerary(graph, origin, golden.points[i], { enabled: [], directWalkM: extended.direct_walk_m });
      expect(trip.total).toBeCloseTo(extended.times[i], 9);
      expect(trip.legs.map((l) => l.type)).toEqual(['walk']);
      expect(trip.legs[0].metres).toBeGreaterThan(walk.max_access_m);
      expect(trip.legs[0].minutes).toBeCloseTo(trip.total, 6);
    });
  });

  it('is exactly the old result when no direct limit is given or it is lower than max_access_m', () => {
    const base = travelTimes(graph, origin, golden.points, { enabled: [] });
    expect(travelTimes(graph, origin, golden.points, { enabled: [], directWalkM: 10 })).toEqual(base);
    expect(itinerary(graph, origin, golden.points[0], { enabled: [] })).toEqual(
      itinerary(graph, origin, golden.points[0], { enabled: [], directWalkM: 10 }),
    );
  });

  it('nodeTimes agree with travelTimes at the nodes', () => {
    const nodes = Array.from({ length: graph.streets.n }, (_, i) => [graph.streets.lat[i], graph.streets.lon[i]]);
    const times = nodeTimes(graph, origin, { enabled: [], directWalkM: 3500 });
    travelTimes(graph, origin, nodes, { enabled: [], directWalkM: 3500 }).forEach((v, i) => {
      if (v === null) expect(times[i]).toBe(Infinity);
      else expect(Math.abs(times[i] - v)).toBeLessThan(EPS);
    });
  });
});

describe('scene in walk-only mode follows the scale', () => {
  const bbox = [-4.74, 41.58, -4.6, 41.62];
  const grid = createGrid(bbox, 100);
  const city = cityDefaults({
    id: 'x', bbox, center: [41.6, -4.7],
    modes: { foot: { kind: 'walk' }, road: { kind: 'transit' }, rail: { kind: 'transit' } },
  });
  const state = { ...defaultState(city), origin, modes: [], isochrones: [5, 15, 30, 45], scale: 45 };

  it('reaches further the larger the scale', () => {
    const reached = (scale) => Array.from(computeScene(graph, grid, { ...state, scale }).nodes).filter(Number.isFinite).length;
    expect(reached(10)).toBeLessThan(reached(20));
    expect(reached(20)).toBeLessThan(reached(45));
  });

  it('the 15, 30 and 45 minute lines are distinct and nest outward', () => {
    const { contours } = computeScene(graph, grid, { ...state, isochrones: [15, 30, 45] });
    const [a, b, c] = [15, 30, 45].map((m) => contours[m]);
    [a, b, c].forEach((lines) => expect(lines.length).toBeGreaterThan(0));
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
    expect(JSON.stringify(b)).not.toBe(JSON.stringify(c));
  });

  it('with transit the scale does not change the nodes', () => {
    const nodes = (scale) => computeScene(graph, grid, { ...state, modes: ['road'], scale }).nodes;
    expect(nodes(10)).toEqual(nodes(45));
  });

  it('a destination beyond max_access_m is a reachable trip equal to the node time', () => {
    const scene = computeScene(graph, grid, state);
    const i = scene.nodes.findIndex((t) => t > 20 && t < 40);
    const target = [graph.streets.lat[i], graph.streets.lon[i]];
    const trip = destinationTrip(graph, { ...state, destination: target });
    expect(trip.reachable).toBe(true);
    expect(Math.abs(trip.total - scene.nodes[i])).toBeLessThan(EPS);
  });
});
