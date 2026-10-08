// View-state reducer (R4.2, R4.4, R4.6, R4.7, R4.3). Pure: no DOM.
import { describe, expect, it } from 'vitest';
import { cityDefaults, defaultState, parseState, serializeState } from '../../src/state-url.js';
import { reduce, travelChoice } from '../../src/ui/state.js';

const config = {
  id: 'x',
  bbox: [-5, 41, -4, 42],
  center: [41.5, -4.5],
  modes: { walk: { kind: 'walk' }, a: { kind: 'transit' }, b: { kind: 'transit' } },
};
const city = cityDefaults(config);
const start = defaultState(city);

describe('reduce', () => {
  it('origin and destination replace the points and never mutate', () => {
    const frozen = structuredClone(start);
    expect(reduce(start, { type: 'origin', point: [41.6, -4.6] }, city).origin).toEqual([41.6, -4.6]);
    expect(reduce(start, { type: 'destination', point: [41.7, -4.7] }, city).destination).toEqual([41.7, -4.7]);
    expect(reduce({ ...start, destination: [41.7, -4.7] }, { type: 'destination', point: null }, city).destination).toBeNull();
    expect(start).toEqual(frozen);
  });

  it('ignores points outside the bbox', () => {
    expect(reduce(start, { type: 'origin', point: [50, 0] }, city)).toBe(start);
    expect(reduce(start, { type: 'destination', point: [41.5, 3] }, city)).toBe(start);
  });

  it('invert flips departure and arrival, keeping both points (R4.6)', () => {
    const s = reduce({ ...start, destination: [41.7, -4.7] }, { type: 'invert' }, city);
    expect(s.direction).toBe('arrival');
    expect(s.origin).toEqual(start.origin);
    expect(s.destination).toEqual([41.7, -4.7]);
    expect(reduce(s, { type: 'invert' }, city).direction).toBe('departure');
  });

  it('toggles transit modes the city declares and ignores unknown ids (R4.7)', () => {
    const off = reduce(start, { type: 'mode', id: 'a' }, city);
    expect(off.modes).toEqual(city.defaultModes.filter((m) => m !== 'a'));
    expect(reduce(off, { type: 'mode', id: 'a' }, city).modes).toContain('a');
    expect(reduce(start, { type: 'mode', id: 'walk' }, city)).toBe(start);
  });

  it('travel chooses between every transit mode and walking only, and round-trips through the URL', () => {
    const walk = reduce(start, { type: 'travel', choice: 'walk' }, city);
    expect(walk.modes).toEqual([]);
    expect(travelChoice(walk)).toBe('walk');
    const transit = reduce(walk, { type: 'travel', choice: 'transit' }, city);
    expect(transit.modes).toEqual(city.modes);
    expect(travelChoice(transit)).toBe('transit');
    expect(reduce(start, { type: 'travel', choice: 'transit' }, city).modes).toEqual(city.modes);
    expect(reduce(walk, { type: 'travel', choice: 'walk' }, city)).toBe(walk);
    expect(reduce(start, { type: 'travel', choice: 'nope' }, city)).toBe(start);
    const query = serializeState(walk);
    expect(query).toContain('modes=&');
    expect(parseState(query, city).state.modes).toEqual([]);
  });

  it('toggles isochrones among the allowed minutes, keeping them sorted (R4.4)', () => {
    const with45 = reduce(start, { type: 'iso', minutes: 45 }, city);
    expect(with45.isochrones).toEqual([15, 30, 45]);
    expect(reduce(with45, { type: 'iso', minutes: 15 }, city).isochrones).toEqual([30, 45]);
    expect(reduce(start, { type: 'iso', minutes: 7 }, city)).toBe(start);
  });

  it('scale is rounded and clamped to the allowed range (R4.3)', () => {
    expect(reduce(start, { type: 'scale', value: 30.4 }, city).scale).toBe(30);
    expect(reduce(start, { type: 'scale', value: 9999 }, city).scale).toBe(120);
    expect(reduce(start, { type: 'scale', value: -4 }, city).scale).toBe(5);
    expect(reduce(start, { type: 'scale', value: 'x' }, city)).toBe(start);
  });

  it('replace swaps in a whole state; unknown actions throw', () => {
    const other = { ...start, scale: 20 };
    expect(reduce(start, { type: 'replace', state: other }, city)).toBe(other);
    expect(() => reduce(start, { type: 'nope' }, city)).toThrow(/nope/);
  });
});
