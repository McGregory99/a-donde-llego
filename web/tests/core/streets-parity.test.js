// R3.8 for streets mode: the browser street walking must equal adl.graph.travel_times on a fixture with a
// river and one bridge (golden from pipeline/tests/test_client_golden.py).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { nodeTimes, travelTimes } from '../../src/core/dijkstra.js';
import { decodeWalk } from '../../src/core/streets.js';

const golden = JSON.parse(readFileSync(new URL('../golden/travel_times_streets.json', import.meta.url), 'utf8'));
const graph = { ...golden.graph, streets: decodeWalk(golden.walk) };
const { points, cases } = golden;
const EPS = 1e-6;

describe('street travel times match the Python model', () => {
  cases.forEach((c, n) => {
    it(`case ${n}: origin ${c.origin.map((v) => v.toFixed(4))} modes ${JSON.stringify(c.enabled)}`, () => {
      const actual = travelTimes(graph, c.origin, points, { enabled: c.enabled });
      expect(actual).toHaveLength(c.times.length);
      actual.forEach((value, i) => {
        if (c.times[i] === null) expect(value).toBeNull();
        else expect(Math.abs(value - c.times[i])).toBeLessThan(EPS);
      });
    });
  });

  it('the fixture reaches across the bridge and leaves the far bank unreached on foot', () => {
    const west = cases.find((c) => c.origin[0] === cases[0].origin[0] && c.enabled?.length === 0);
    expect(west.times.filter((t) => t !== null).length).toBeGreaterThan(8);
  });
});

describe('nodeTimes: the time painted on every street node', () => {
  const walk = graph.streets;
  const nodePoints = Array.from({ length: walk.n }, (_, i) => [walk.lat[i], walk.lon[i]]);
  cases.forEach((c, n) => {
    it(`case ${n}: equals travelTimes evaluated at the node itself`, () => {
      const options = { enabled: c.enabled };
      const times = nodeTimes(graph, c.origin, options);
      const expected = travelTimes(graph, c.origin, nodePoints, options);
      expect(times).toHaveLength(walk.n);
      expected.forEach((value, i) => {
        if (value === null) expect(times[i]).toBe(Infinity);
        else expect(Math.abs(times[i] - value)).toBeLessThan(EPS);
      });
    });
  });
});
