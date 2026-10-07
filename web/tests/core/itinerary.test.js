// R5.1-R5.6: step-by-step itinerary whose total equals the heat-map value at the point.
// The Python golden (adl.graph.travel_times) is the reference for every total.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { itinerary } from '../../src/core/itinerary.js';
import { travelTimes } from '../../src/core/dijkstra.js';

const golden = JSON.parse(readFileSync(new URL('../golden/travel_times.json', import.meta.url), 'utf8'));
const { graph, points, cases } = golden;
const EPS = 1e-9;
const all = cases.filter((c) => c.enabled === null);
const types = (it) => it.legs.map((leg) => leg.type);
const sum = (it) => it.legs.reduce((total, leg) => total + leg.minutes, 0);
const modeOf = (leg) => graph.lines[leg.line].mode;

describe('itinerary total equals the heat-map value (R5.3)', () => {
  cases.forEach((c, n) => {
    it(`departure, case ${n}: every point matches the Python model`, () => {
      let reached = 0;
      points.forEach((p, i) => {
        const result = itinerary(graph, c.origin, p, { enabled: c.enabled });
        if (c.times[i] === null) return expect(result).toBeNull();
        reached += 1;
        expect(Math.abs(result.total - c.times[i])).toBeLessThan(EPS);
        expect(Math.abs(sum(result) - c.times[i])).toBeLessThan(1e-6);
      });
      expect(reached).toBeGreaterThan(0);
    });
  });

  it('arrival: the itinerary from P to the destination equals the forward Python time O->P', () => {
    let checked = 0;
    all.forEach((c) => {
      points.forEach((p, i) => {
        // anchor = destination, point = where the user clicked (the trip starts there)
        const result = itinerary(graph, p, c.origin, { reverse: true });
        if (c.times[i] === null) return expect(result).toBeNull();
        checked += 1;
        expect(Math.abs(result.total - c.times[i])).toBeLessThan(EPS);
        expect(Math.abs(sum(result) - c.times[i])).toBeLessThan(1e-6);
      });
    });
    expect(checked).toBeGreaterThan(100);
  });

  it('is null for a point beyond the limit and total agrees with travelTimes', () => {
    const far = [graph.stops[0].lat + 1, graph.stops[0].lon + 1];
    expect(itinerary(graph, cases[0].origin, far)).toBeNull();
    expect(travelTimes(graph, cases[0].origin, [far])[0]).toBeNull();
  });
});

describe('leg structure (R5.2)', () => {
  const origin = all[0].origin;
  const itineraries = points.map((p) => itinerary(graph, origin, p)).filter(Boolean);

  it('a point within walking distance only is a single walking leg', () => {
    const near = itinerary(graph, origin, [origin[0] + 0.001, origin[1]]);
    expect(types(near)).toEqual(['walk']);
    expect(near.legs[0].minutes).toBeCloseTo(near.total, 12);
  });

  it('one bus: walk, wait, ride, walk with boarding and alighting stops', () => {
    const one = itineraries.find((it) => types(it).join() === 'walk,wait,ride,walk');
    expect(one).toBeDefined();
    const [, wait, ride] = one.legs;
    expect(wait.stop).toBe(ride.from);
    expect(wait.line).toBe(ride.line);
    expect(ride.stops[0]).toBe(ride.from);
    expect(ride.stops.at(-1)).toBe(ride.to);
    expect(ride.stops.length).toBeGreaterThan(1);
  });

  it('a path with a line change shows both lines and the transfer step', () => {
    const change = itineraries.find((it) => types(it).includes('transfer'));
    expect(change).toBeDefined();
    expect(types(change)).toEqual(['walk', 'wait', 'ride', 'transfer', 'wait', 'ride', 'walk']);
    const rides = change.legs.filter((leg) => leg.type === 'ride');
    expect(rides[0].line).not.toBe(rides[1].line);
    const transfer = change.legs.find((leg) => leg.type === 'transfer');
    expect(transfer.fromStop).toBe(rides[0].to);
    expect(transfer.toStop).toBe(rides[1].from);
    expect(transfer.minutes).toBeCloseTo(transfer.walkMinutes + transfer.penaltyMinutes, 12);
    expect(transfer.penaltyMinutes).toBe(graph.modes[modeOf(rides[1])].transfer_min);
  });

  it('every ride leg is the sum of consecutive graph edges on that line', () => {
    const rideLegs = itineraries.flatMap((it) => it.legs.filter((leg) => leg.type === 'ride'));
    expect(rideLegs.length).toBeGreaterThan(5);
    for (const leg of rideLegs) {
      let minutes = 0;
      for (let k = 1; k < leg.stops.length; k += 1) {
        const edge = graph.rides.find(([l, a, b]) => l === leg.line && a === leg.stops[k - 1] && b === leg.stops[k]);
        expect(edge).toBeDefined();
        minutes += edge[3];
      }
      expect(Math.abs(minutes - leg.minutes)).toBeLessThan(1e-9);
    }
  });

  it('wait legs carry the line wait from the graph', () => {
    const waits = itineraries.flatMap((it) => it.legs.filter((leg) => leg.type === 'wait'));
    expect(waits.length).toBeGreaterThan(5);
    for (const leg of waits) {
      const [, , minutes] = graph.waits.find(([s, l]) => s === leg.stop && l === leg.line);
      expect(leg.minutes).toBe(minutes);
    }
  });

  it('respects the mode toggle: walk-only is one leg, one mode never boards another', () => {
    const walkOnly = points.map((p) => itinerary(graph, origin, p, { enabled: [] })).filter(Boolean);
    expect(walkOnly.length).toBeGreaterThan(0);
    walkOnly.forEach((it) => expect(types(it)).toEqual(['walk']));
    const road = points.map((p) => itinerary(graph, origin, p, { enabled: ['road'] })).filter(Boolean);
    const rideLegs = road.flatMap((it) => it.legs.filter((leg) => leg.type === 'ride'));
    expect(rideLegs.length).toBeGreaterThan(0);
    rideLegs.forEach((leg) => expect(modeOf(leg)).toBe('road'));
  });
});

describe('direction and map path (R5.4, R5.6)', () => {
  const transit = (list) => list.find((it) => it && types(it).includes('ride'));

  it('departure: path runs from the departure to the clicked point', () => {
    const origin = all[0].origin;
    const p = points.find((q) => transit([itinerary(graph, origin, q)]));
    const it = itinerary(graph, origin, p);
    expect(it.path[0]).toEqual(origin);
    expect(it.path.at(-1)).toEqual(p);
    expect(it.path.length).toBeGreaterThan(2);
  });

  it('arrival: the itinerary starts at the clicked point and ends at the destination', () => {
    const destination = all[0].origin;
    const p = points.find((q) => transit([itinerary(graph, destination, q, { reverse: true }), ]) );
    const it = itinerary(graph, destination, p, { reverse: true });
    expect(it.path[0]).toEqual(p);
    expect(it.path.at(-1)).toEqual(destination);
    expect(types(it).includes('ride')).toBe(true);
    const ride = it.legs.find((leg) => leg.type === 'ride');
    const wait = it.legs.find((leg) => leg.type === 'wait');
    expect(wait.stop).toBe(ride.from);
  });

  it('arrival with a line change keeps legs in travel order', () => {
    const destination = all[0].origin;
    const change = points
      .map((p) => itinerary(graph, destination, p, { reverse: true }))
      .find((it) => it && types(it).includes('transfer'));
    expect(change).toBeDefined();
    expect(types(change)).toEqual(['walk', 'wait', 'ride', 'transfer', 'wait', 'ride', 'walk']);
    const rides = change.legs.filter((leg) => leg.type === 'ride');
    expect(rides[0].to).toBe(change.legs.find((leg) => leg.type === 'transfer').fromStop);
  });
});
