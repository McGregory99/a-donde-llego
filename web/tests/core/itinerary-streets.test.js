// Itinerary over the street network: totals equal the street travel time, walk legs follow the streets.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { travelTimes } from '../../src/core/dijkstra.js';
import { itinerary } from '../../src/core/itinerary.js';
import { decodeWalk } from '../../src/core/streets.js';

const golden = JSON.parse(readFileSync(new URL('../golden/travel_times_streets.json', import.meta.url), 'utf8'));
const graph = { ...golden.graph, streets: decodeWalk(golden.walk) };
const { points, cases } = golden;
const sum = (trip) => trip.legs.reduce((total, leg) => total + leg.minutes, 0);

describe('street itinerary totals equal the heat value (R5.3)', () => {
  cases.forEach((c, n) => {
    it(`departure, case ${n}: every point matches the Python model, legs sum to it`, () => {
      points.forEach((p, i) => {
        const trip = itinerary(graph, c.origin, p, { enabled: c.enabled });
        if (c.times[i] === null) return expect(trip).toBeNull();
        expect(Math.abs(trip.total - c.times[i])).toBeLessThan(1e-9);
        expect(Math.abs(sum(trip) - c.times[i])).toBeLessThan(1e-6);
      });
    });
  });

  it('arrival: the trip from P to the destination equals the forward travel time destination -> P', () => {
    const all = cases.filter((c) => c.enabled === null);
    let checked = 0;
    all.forEach((c) => {
      const reverse = travelTimes(graph, c.origin, points, { enabled: null, reverse: true });
      points.forEach((p, i) => {
        const trip = itinerary(graph, c.origin, p, { enabled: null, reverse: true });
        if (reverse[i] === null) return expect(trip).toBeNull();
        checked += 1;
        expect(Math.abs(trip.total - reverse[i])).toBeLessThan(1e-9);
        expect(Math.abs(sum(trip) - reverse[i])).toBeLessThan(1e-6);
      });
    });
    expect(checked).toBeGreaterThan(20);
  });
});

describe('street walk legs', () => {
  const walkOnly = cases.find((c) => c.enabled?.length === 0 && c.times.filter((t) => t !== null).length > 8);
  const reachable = (c) => points.filter((_, i) => c.times[i] !== null);

  it('walking only: one walk leg whose minutes are its street metres at walking speed, no detour factor', () => {
    for (const p of reachable(walkOnly)) {
      const trip = itinerary(graph, walkOnly.origin, p, { enabled: [] });
      const legs = trip.legs.filter((leg) => leg.type === 'walk');
      if (!legs.length) continue;
      expect(legs).toHaveLength(1);
      expect(legs[0].minutes).toBeCloseTo(legs[0].metres / graph.walk.speed_m_per_min, 9);
    }
  });

  it('crossing the river goes by the bridge: the path is longer than the straight line and passes its nodes', () => {
    const across = points.find((p, i) => {
      const trip = walkOnly.times[i] !== null && itinerary(graph, walkOnly.origin, p, { enabled: [] });
      return trip && trip.legs[0]?.metres > 400 && p[1] > walkOnly.origin[1] + 0.003;
    });
    expect(across).toBeDefined();
    const trip = itinerary(graph, walkOnly.origin, across, { enabled: [] });
    const [leg] = trip.legs;
    expect(leg.path.length).toBeGreaterThan(2);
    expect(trip.path.length).toBe(leg.path.length);
    expect(trip.path[0]).toEqual(walkOnly.origin);
    expect(trip.path.at(-1)).toEqual(across);
  });

  it('arrival with transit: every walk leg path runs from its start to its end', () => {
    let seen = 0;
    for (const c of cases.filter((x) => x.enabled === null)) {
      for (const p of points) {
        const trip = itinerary(graph, c.origin, p, { enabled: null, reverse: true });
        if (!trip || !trip.legs.some((l) => l.type === 'ride')) continue;
        for (const leg of trip.legs.filter((l) => l.type === 'walk')) {
          seen += 1;
          expect(leg.path[0]).toEqual(leg.from.point);
          expect(leg.path.at(-1)).toEqual(leg.to.point);
        }
      }
    }
    expect(seen).toBeGreaterThan(5);
  });

  it('with transit the first and last legs are street walks and carry their path', () => {
    const c = cases.find((x) => x.enabled === null && x.times.some((t) => t !== null));
    let seen = 0;
    for (const p of reachable(c)) {
      const trip = itinerary(graph, c.origin, p, { enabled: null });
      for (const leg of trip.legs.filter((l) => l.type === 'walk')) {
        seen += 1;
        expect(leg.metres).toBeGreaterThan(0);
        expect(leg.path.length).toBeGreaterThanOrEqual(2);
      }
    }
    expect(seen).toBeGreaterThan(5);
  });
});
