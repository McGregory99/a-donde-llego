// R4.3, R4.8: ~100 m sampling grid over the city bbox and its travel-time raster.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cellCenter, computeGrid, createGrid } from '../../src/core/grid.js';
import { travelTimes } from '../../src/core/dijkstra.js';
import { distanceM } from '../../src/core/geo.js';

const golden = JSON.parse(readFileSync(new URL('../golden/travel_times.json', import.meta.url), 'utf8'));
const { graph, cases } = golden;
const BBOX = [-4.78, 41.55, -4.7, 41.62]; // [west, south, east, north]

describe('createGrid', () => {
  it('covers the bbox with cells of about the requested size', () => {
    const grid = createGrid(BBOX, 100);
    const [w, s, e, n] = BBOX;
    const width = distanceM([(s + n) / 2, w], [(s + n) / 2, e]);
    const height = distanceM([s, w], [n, w]);
    expect(grid.cols).toBe(Math.ceil(width / 100));
    expect(grid.rows).toBe(Math.ceil(height / 100));
    const first = cellCenter(grid, 0, 0);
    const last = cellCenter(grid, grid.rows - 1, grid.cols - 1);
    expect(first[0]).toBeGreaterThan(s);
    expect(last[0]).toBeLessThan(n);
    expect(first[1]).toBeGreaterThan(w);
    expect(last[1]).toBeLessThan(e);
  });

  it('rejects an empty bbox or a non-positive cell size', () => {
    expect(() => createGrid([1, 1, 1, 2], 100)).toThrow(/bbox/);
    expect(() => createGrid(BBOX, 0)).toThrow(/cell/);
  });
});

describe('computeGrid', () => {
  const pointsOf = (grid) => {
    const out = [];
    for (let r = 0; r < grid.rows; r += 1) for (let c = 0; c < grid.cols; c += 1) out.push(cellCenter(grid, r, c));
    return out;
  };
  const grid = createGrid(
    [
      Math.min(...golden.points.map((p) => p[1])) - 0.005, Math.min(...golden.points.map((p) => p[0])) - 0.005,
      Math.max(...golden.points.map((p) => p[1])) + 0.005, Math.max(...golden.points.map((p) => p[0])) + 0.005,
    ],
    250,
  );

  [
    { name: 'departure, all modes', options: {}, origin: cases[0].origin },
    { name: 'departure, one mode', options: { enabled: ['road'] }, origin: cases[0].origin },
    { name: 'arrival', options: { reverse: true }, origin: cases[8].origin },
  ].forEach(({ name, options, origin }) => {
    it(`equals travelTimes at every cell centre: ${name}`, () => {
      const times = computeGrid(grid, graph, origin, options);
      const expected = travelTimes(graph, origin, pointsOf(grid), options);
      expect(times).toHaveLength(grid.cols * grid.rows);
      expected.forEach((value, i) => {
        if (value === null) expect(times[i]).toBeNaN();
        else expect(Math.abs(times[i] - value)).toBeLessThan(1e-3);
      });
    });
  });

  it('leaves cells nobody can reach as NaN', () => {
    const times = computeGrid(grid, graph, cases[0].origin);
    expect(times.some(Number.isNaN)).toBe(true);
    expect(times.some((t) => t === 0 || t > 0)).toBe(true);
  });
});

describe('performance (R4.8)', () => {
  function synthetic(stops, lineCount) {
    let seed = 7;
    const rand = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    const list = Array.from({ length: stops }, (_, i) => ({
      id: `s${i}`, name: `s${i}`, lat: 41.52 + rand() * 0.29, lon: -4.93 + rand() * 0.3,
    }));
    const lines = Array.from({ length: lineCount }, (_, i) => ({ id: `l${i}`, mode: 'road' }));
    const waits = [];
    const rides = [];
    lines.forEach((_, line) => {
      const route = Array.from({ length: 10 }, () => Math.floor(rand() * stops));
      route.forEach((stop, k) => {
        waits.push([stop, line, 5]);
        if (k) rides.push([line, route[k - 1], stop, 3]);
      });
    });
    const neighbors = list.map((a, i) =>
      list.flatMap((b, j) => {
        const d = i === j ? Infinity : distanceM([a.lat, a.lon], [b.lat, b.lon]);
        return d <= 400 ? [[j, d / 75]] : [];
      }),
    );
    const walk = { speed_m_per_min: 75, detour_factor: 1, max_access_m: 1000, max_transfer_walk_m: 400 };
    return { stops: list, lines, waits, rides, neighbors, walk, modes: { road: { transfer_min: 1.5 } } };
  }

  it('recomputes the full-city grid on 570 stops in under one second', () => {
    const big = synthetic(570, 58);
    const city = createGrid([-4.93, 41.52, -4.63, 41.81], 100);
    const start = big.stops[big.rides[0][1]];
    const origin = [start.lat, start.lon];
    computeGrid(city, big, [41.62, -4.72]); // warm-up (prepares lookup tables, JIT)
    const started = performance.now();
    const times = computeGrid(city, big, origin);
    const elapsed = performance.now() - started;
    expect(times.some((t) => t > 15)).toBe(true);
    expect(elapsed).toBeLessThan(1000);
  });
});
