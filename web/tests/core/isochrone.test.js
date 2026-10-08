// R4.4: isochrone contours from the travel-time raster (marching squares).
import { describe, expect, it } from 'vitest';
import { createGrid, cellCenter } from '../../src/core/grid.js';
import { distanceM } from '../../src/core/geo.js';
import { isochrones, smoothGrid } from '../../src/core/isochrone.js';

const BBOX = [-4.75, 41.58, -4.69, 41.64];
const grid = createGrid(BBOX, 100);
const centre = [(BBOX[1] + BBOX[3]) / 2, (BBOX[0] + BBOX[2]) / 2];

/** Walking minutes from the centre at 75 m/min: concentric circles. */
function cone() {
  const times = new Float32Array(grid.cols * grid.rows);
  for (let r = 0; r < grid.rows; r += 1) {
    for (let c = 0; c < grid.cols; c += 1) times[r * grid.cols + c] = distanceM(centre, cellCenter(grid, r, c)) / 75;
  }
  return times;
}

describe('isochrones', () => {
  it('traces a ring at the threshold distance', () => {
    const { 15: segments } = isochrones(grid, cone(), [15]);
    expect(segments.length).toBeGreaterThan(20);
    for (const segment of segments) {
      expect(segment).toHaveLength(2);
      for (const point of segment) expect(Math.abs(distanceM(centre, point) - 15 * 75)).toBeLessThan(120);
    }
  });

  it('draws one ring per threshold, larger for larger thresholds', () => {
    const rings = isochrones(grid, cone(), [5, 10]);
    expect(Object.keys(rings)).toEqual(['5', '10']);
    const radius = (segments) => Math.max(...segments.flat().map((p) => distanceM(centre, p)));
    expect(radius(rings[10])).toBeGreaterThan(radius(rings[5]));
  });

  it('is empty when the threshold is outside the data range', () => {
    const { 1: below, 9999: above } = isochrones(grid, cone(), [1, 9999]);
    expect(below).toEqual([]);
    expect(above).toEqual([]);
  });

  it('treats unreachable (NaN) cells as outside', () => {
    expect(isochrones(grid, new Float32Array(grid.cols * grid.rows).fill(NaN), [15])[15]).toEqual([]);
  });
});

describe('smoothGrid', () => {
  it('keeps NaN cells NaN and averages the rest', () => {
    const times = new Float32Array(9).fill(10);
    times[0] = NaN;
    times[4] = 19;
    const out = smoothGrid(times, 3, 3);
    expect(out[0]).toBeNaN();
    expect(out[4]).toBeCloseTo((19 * 2 + 10 * 7) / 9, 4);
  });
});
