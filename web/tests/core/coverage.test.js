// Reach percentages are measured over the served area, never over the bbox (diagnosis-reach).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { computeGrid, createGrid } from '../../src/core/grid.js';
import { coverageMask, reachPercent } from '../../src/core/coverage.js';
import { pointInPolygons } from '../../src/core/geo.js';

const { graph, points, cases } = JSON.parse(
  readFileSync(new URL('../golden/travel_times.json', import.meta.url), 'utf8'),
);
const lats = points.map((p) => p[0]);
const lons = points.map((p) => p[1]);
const PAD = 0.02; // wide margin of empty bbox around the network
const grid = createGrid(
  [Math.min(...lons) - PAD, Math.min(...lats) - PAD, Math.max(...lons) + PAD, Math.max(...lats) + PAD],
  250,
);
const ring = (w, s, e, n) => [[s, w], [s, e], [n, e], [n, w], [s, w]];

describe('pointInPolygons', () => {
  const outer = ring(0, 0, 10, 10);
  const hole = ring(4, 4, 6, 6);
  it('is true inside an outer ring and false outside it', () => {
    expect(pointInPolygons([[outer]], [2, 2])).toBe(true);
    expect(pointInPolygons([[outer]], [20, 2])).toBe(false);
  });
  it('excludes holes and accepts any polygon of the set', () => {
    expect(pointInPolygons([[outer, hole]], [5, 5])).toBe(false);
    expect(pointInPolygons([[ring(50, 50, 60, 60)], [outer, hole]], [2, 2])).toBe(true);
  });
});

describe('coverageMask', () => {
  it('without a boundary keeps only cells within the walking radius of a stop', () => {
    const mask = coverageMask(grid, graph, null);
    const covered = mask.reduce((n, v) => n + v, 0);
    expect(covered).toBeGreaterThan(0);
    expect(covered).toBeLessThan(grid.cols * grid.rows / 2);
    expect(mask[0]).toBe(0); // south-west bbox corner is far from every stop
  });

  it('with a boundary keeps exactly the cells whose centre is inside it', () => {
    const [w, s, e, n] = grid.bbox;
    const half = [[ring(w, s, (w + e) / 2, n)]];
    const mask = coverageMask(grid, graph, { polygons: half });
    const covered = mask.reduce((c, v) => c + v, 0);
    expect(covered).toBeGreaterThan(0);
    expect(Math.abs(covered - (grid.cols * grid.rows) / 2)).toBeLessThanOrEqual(grid.rows);
    expect(mask[grid.cols - 1]).toBe(0); // south-east corner is outside the half
    expect(mask[0]).toBe(1);
  });

  it('an empty polygon list behaves like no boundary', () => {
    expect(coverageMask(grid, graph, { id: null, polygons: [] })).toEqual(coverageMask(grid, graph, null));
  });
});

describe('reachPercent', () => {
  const times = computeGrid(grid, graph, cases[0].origin);

  it('is the share of covered cells within the threshold, not of the bbox', () => {
    const mask = coverageMask(grid, graph, null);
    const withinCovered = times.reduce((n, t, i) => n + (mask[i] && t <= 30 ? 1 : 0), 0);
    const covered = mask.reduce((n, v) => n + v, 0);
    const percent = reachPercent(times, mask, 30);
    expect(percent).toBeCloseTo((100 * withinCovered) / covered, 9);
    const overBbox = (100 * times.filter((t) => t <= 30).length) / times.length;
    expect(percent).toBeGreaterThan(overBbox * 2); // the bbox share is badly diluted
  });

  it('grows with the threshold and is 0 for a threshold below every time', () => {
    const mask = coverageMask(grid, graph, null);
    expect(reachPercent(times, mask, 60)).toBeGreaterThan(reachPercent(times, mask, 15));
    expect(reachPercent(times, mask, -1)).toBe(0);
  });

  it('returns 0 when the mask is empty instead of dividing by zero', () => {
    expect(reachPercent(times, new Uint8Array(times.length), 30)).toBe(0);
  });
});
