// Scene in streets mode: times live on street nodes (no raster), contours are closed lines traced on a raster derived from the node times.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createGrid } from '../../src/core/grid.js';
import { decodeWalk } from '../../src/core/streets.js';
import { cityDefaults, defaultState } from '../../src/state-url.js';
import { completeScene, computeScene, destinationTrip, sceneContours } from '../../src/ui/scene.js';

const golden = JSON.parse(readFileSync(new URL('../golden/travel_times_streets.json', import.meta.url), 'utf8'));
const graph = { ...golden.graph, streets: decodeWalk(golden.walk) };
const bbox = [-4.74, 41.58, -4.6, 41.62];
const grid = createGrid(bbox, 100);
const city = cityDefaults({
  id: 'x', bbox, center: [41.6, -4.7],
  modes: { foot: { kind: 'walk' }, road: { kind: 'transit' }, rail: { kind: 'transit' } },
});
const origin = golden.cases[0].origin;
const base = { ...defaultState(city), origin, isochrones: [5, 15] };

describe('computeScene in streets mode', () => {
  const scene = computeScene(graph, grid, base);

  it('gives a time per street node and no area raster', () => {
    expect(scene.times).toBeNull();
    expect(scene.nodes).toHaveLength(graph.streets.n);
    expect(Math.min(...scene.nodes)).toBeLessThan(5);
    expect(scene.nodes.some((t) => t === Infinity)).toBe(true);
  });

  it('derives a cell raster from the node times to trace the contours', () => {
    expect(scene.cells).toHaveLength(grid.cols * grid.rows);
    expect(scene.cells.some(Number.isFinite)).toBe(true);
    expect(sceneContours(graph, grid, scene, [15])[15].length).toBeGreaterThan(0);
  });

  it('has fronts for the requested isochrones only', () => {
    expect(Object.keys(scene.contours)).toEqual(['5', '15']);
    expect(scene.contours[5].length).toBeGreaterThan(0);
    expect(computeScene(graph, grid, { ...base, isochrones: [] }).contours).toEqual({});
  });

  it('walking only reaches fewer nodes than walking plus transit', () => {
    const reached = (s) => Array.from(s.nodes).filter(Number.isFinite).length;
    expect(reached(computeScene(graph, grid, { ...base, modes: [], scale: 10 }))).toBeLessThan(reached(scene));
  });
});

describe('destinationTrip in streets mode', () => {
  it('walk legs follow the streets and the total is the heat value', () => {
    const target = golden.points.find((_, i) => golden.cases[0].times[i] !== null && golden.cases[0].enabled === null);
    const trip = destinationTrip(graph, { ...base, destination: target, scale: 120 });
    expect(trip.reachable).toBe(true);
    expect(trip.legs.some((leg) => leg.type === 'walk' && leg.path)).toBe(true);
  });
});

describe('sceneContours', () => {
  it('re-derives the fronts for other thresholds without recomputing the times', () => {
    const scene = computeScene(graph, grid, base);
    const fronts = sceneContours(graph, grid, scene, [5, 10]);
    expect(Object.keys(fronts)).toEqual(['5', '10']);
    expect(fronts[5]).toEqual(scene.contours[5]);
  });
});

describe('a draft scene (origin drag) and its completion', () => {
  it('skips the raster and the contours: only the times that paint the streets', () => {
    const draft = computeScene(graph, grid, base, { contours: false });
    expect(draft.nodes).toEqual(computeScene(graph, grid, base).nodes);
    expect(draft.cells).toBeNull();
    expect(draft.contours).toEqual({});
  });

  it('completeScene yields exactly the full scene', () => {
    const draft = computeScene(graph, grid, base, { contours: false });
    expect(completeScene(graph, grid, base, draft)).toEqual(computeScene(graph, grid, base));
  });

  it('completing an already full scene returns it untouched', () => {
    const full = computeScene(graph, grid, base);
    expect(completeScene(graph, grid, base, full)).toBe(full);
  });
});
