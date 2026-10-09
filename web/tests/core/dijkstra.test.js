// R3.8, R4.6, R4.7: the browser model must equal the Python model (golden from
// pipeline/tests/test_client_golden.py) and support arrival mode and mode toggles.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { stopTimes, travelTimes } from '../../src/core/dijkstra.js';

const golden = JSON.parse(readFileSync(new URL('../golden/travel_times.json', import.meta.url), 'utf8'));
const { graph, points, cases } = golden;
const EPS = 1e-6;

function expectSame(actual, expected) {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((value, i) => {
    if (expected[i] === null) expect(value).toBeNull();
    else expect(Math.abs(value - expected[i])).toBeLessThan(EPS);
  });
}

describe('forward travel times match the Python model', () => {
  cases.forEach((c, n) => {
    it(`case ${n}: origin ${c.origin.map((v) => v.toFixed(3))} modes ${JSON.stringify(c.enabled)}`, () => {
      expectSame(travelTimes(graph, c.origin, points, { enabled: c.enabled, directWalkM: c.direct_walk_m }), c.times);
    });
  });
});

describe('mode toggle (R4.7)', () => {
  it('walk-only reaches nothing beyond the access radius', () => {
    const origin = cases[0].origin;
    const times = travelTimes(graph, origin, points, { enabled: [] });
    const reached = times.filter((t) => t !== null);
    expect(reached.length).toBeGreaterThan(0);
    expect(Math.max(...reached)).toBeLessThanOrEqual(graph.walk.max_access_m / graph.walk.speed_m_per_min + EPS);
  });

  it('a transit mode never makes a point slower', () => {
    const all = travelTimes(graph, cases[0].origin, points);
    const walk = travelTimes(graph, cases[0].origin, points, { enabled: [] });
    all.forEach((t, i) => {
      if (walk[i] !== null) expect(t).toBeLessThanOrEqual(walk[i] + EPS);
    });
  });
});

describe('arrival mode (R4.6)', () => {
  it('time from O to P equals the reverse query for destination P at O', () => {
    const origins = cases.filter((c) => c.enabled === null).map((c) => c.origin);
    const forward = cases.filter((c) => c.enabled === null);
    points.forEach((p, i) => {
      const back = travelTimes(graph, p, origins, { reverse: true });
      expectSame(back, forward.map((c) => c.times[i]));
    });
  });

  it('respects the mode toggle too', () => {
    const c = cases.find((x) => JSON.stringify(x.enabled) === '["road"]');
    const p = points.findIndex((_, i) => c.times[i] !== null && c.times[i] > 10);
    const back = travelTimes(graph, points[p], [c.origin], { reverse: true, enabled: ['road'] });
    expectSame(back, [c.times[p]]);
  });
});

describe('stopTimes', () => {
  it('only ridden stops get a time and the rest are Infinity', () => {
    const times = stopTimes(graph, cases[0].origin);
    expect(times).toHaveLength(graph.stops.length);
    expect(times.some((t) => Number.isFinite(t))).toBe(true);
    expect(times.some((t) => t === Infinity)).toBe(true);
  });
});
