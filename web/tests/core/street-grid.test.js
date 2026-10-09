// Travel-time raster derived from street node times: the basis of the smooth isochrone lines on streets.
import { describe, expect, it } from 'vitest';
import { createGrid, cellCenter } from '../../src/core/grid.js';
import { isochrones } from '../../src/core/isochrone.js';
import { distanceM, walkMinutes } from '../../src/core/geo.js';
import { streetTimeGrid } from '../../src/core/street-grid.js';

const walk = { detour_factor: 1.3, speed_m_per_min: 75, max_snap_m: 150 };
// Nodes laid out on a 9 x 9 lattice of ~100 m, node time = minutes from the centre.
const bbox = [-4.706, 41.597, -4.694, 41.603];
const grid = createGrid(bbox, 100);
const centre = [41.6, -4.7];
const lattice = [];
for (let i = -4; i <= 4; i += 1) for (let j = -4; j <= 4; j += 1) lattice.push([41.6 + i * 0.0009, -4.7 + j * 0.0012]);
const streets = { n: lattice.length, lat: lattice.map(([lat]) => lat), lon: lattice.map(([, lon]) => lon) };
const times = Float64Array.from(lattice.map((p) => distanceM(centre, p) / 75));

describe('streetTimeGrid', () => {
  it('gives a cell near a reached node that node time plus the walk to it', () => {
    const lone = { n: 1, lat: [41.6], lon: [-4.7] };
    const raster = streetTimeGrid(grid, lone, Float64Array.from([10]), walk);
    const index = raster.findIndex((v) => !Number.isNaN(v));
    expect(index).toBeGreaterThanOrEqual(0);
    const at = cellCenter(grid, Math.floor(index / grid.cols), index % grid.cols);
    expect(raster[index]).toBeCloseTo(10 + walkMinutes(distanceM([41.6, -4.7], at), walk), 3);
    expect(Math.min(...raster.filter((v) => !Number.isNaN(v)))).toBeLessThan(11.2);
  });

  it('leaves cells farther than the snap radius from every node unreachable', () => {
    const lone = { n: 1, lat: [41.6], lon: [-4.7] };
    const raster = streetTimeGrid(grid, lone, Float64Array.from([10]), walk);
    for (let index = 0; index < raster.length; index += 1) {
      const at = cellCenter(grid, Math.floor(index / grid.cols), index % grid.cols);
      if (distanceM([41.6, -4.7], at) > walk.max_snap_m) expect(raster[index]).toBeNaN();
    }
    expect(raster.some(Number.isNaN)).toBe(true);
  });

  it('ignores unreached nodes and nodes beyond the time cap', () => {
    const lone = { n: 2, lat: [41.6, 41.6], lon: [-4.7, -4.699] };
    const raster = streetTimeGrid(grid, lone, Float64Array.from([Infinity, 90]), walk, 70);
    expect(raster.every(Number.isNaN)).toBe(true);
  });

  it('keeps the smallest time where catchments overlap', () => {
    const two = { n: 2, lat: [41.6, 41.6], lon: [-4.7, -4.6995] };
    const raster = streetTimeGrid(grid, two, Float64Array.from([20, 5]), walk);
    const near = raster.filter((v) => !Number.isNaN(v));
    expect(Math.min(...near)).toBeLessThan(6);
  });

  it('feeds closed contour lines: every segment end meets another one', () => {
    const raster = streetTimeGrid(grid, streets, times, walk);
    const { 3: segments } = isochrones(grid, raster, [3]);
    expect(segments.length).toBeGreaterThan(8);
    const ends = new Map();
    const key = (p) => `${p[0].toFixed(7)},${p[1].toFixed(7)}`;
    for (const [a, b] of segments) for (const p of [a, b]) ends.set(key(p), (ends.get(key(p)) ?? 0) + 1);
    expect([...ends.values()].every((count) => count % 2 === 0)).toBe(true);
  });
});
