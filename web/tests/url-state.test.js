// R7.1-R7.5: shareable view state in the URL; parsing never trusts its input.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cityDefaults, defaultState, parseState, serializeState } from '../src/state-url.js';

const config = JSON.parse(readFileSync(new URL('../../cities/valladolid.json', import.meta.url), 'utf8'));
const city = cityDefaults(config);
const parse = (search) => parseState(search, city);

describe('url state defaults', () => {
  it('derives defaults from the city config: transit modes only, centre, bbox', () => {
    expect(city.id).toBe(config.id);
    expect(city.bbox).toEqual(config.bbox);
    expect(city.modes).toEqual(['bus']);
    expect(defaultState(city)).toEqual({
      city: config.id,
      origin: config.center,
      direction: 'departure',
      modes: ['bus'],
      isochrones: [15, 30],
      scale: 45,
      destination: null,
    });
  });

  it('an empty or missing query is the default state with nothing ignored', () => {
    for (const q of ['', '?', undefined, null]) {
      expect(parse(q)).toEqual({ state: defaultState(city), ignored: [] });
    }
  });
});

describe('url state round trip (R7.1, R7.2)', () => {
  const state = {
    city: config.id,
    origin: [41.65123, -4.72345],
    direction: 'arrival',
    modes: [],
    isochrones: [15, 45, 60],
    scale: 30,
    destination: [41.64, -4.7],
  };

  it('restores the exact state', () => {
    expect(parse(serializeState(state))).toEqual({ state, ignored: [] });
  });

  it('keeps "no transit mode" distinct from "default modes"', () => {
    const none = parse(serializeState({ ...defaultState(city), modes: [] })).state;
    expect(none.modes).toEqual([]);
    expect(parse('c=' + config.id).state.modes).toEqual(['bus']);
  });

  it('the default state round-trips and a leading ? is accepted', () => {
    const s = defaultState(city);
    expect(parse('?' + serializeState(s))).toEqual({ state: s, ignored: [] });
  });

  it('contains only the view state, no personal data (R7.5)', () => {
    const keys = [...new URLSearchParams(serializeState(state)).keys()].sort();
    expect(keys).toEqual(['c', 'd', 'dir', 'iso', 'max', 'modes', 'o']);
  });

  it('serialises deterministically', () => {
    expect(serializeState(state)).toBe(serializeState({ ...state }));
  });
});

describe('url state robustness (R7.4)', () => {
  it('ignores an origin outside the bbox, falls back to the default and reports it', () => {
    const { state, ignored } = parse('o=10,10');
    expect(state.origin).toEqual(config.center);
    expect(ignored).toContain('o');
  });

  it('ignores malformed coordinates', () => {
    for (const o of ['abc', '41.6', '41.6,', ',-4.7', '41.6,-4.7,1', 'NaN,NaN', 'Infinity,-4.7', '1e1,-4.7', '41.6;-4.7', '']) {
      const { state, ignored } = parse('o=' + encodeURIComponent(o));
      expect(state.origin, o).toEqual(config.center);
      expect(ignored, o).toContain('o');
    }
  });

  it('ignores unknown parameters and does not report them as state', () => {
    const { state, ignored } = parse('foo=bar&__proto__=x&constructor=y');
    expect(state).toEqual(defaultState(city));
    expect(ignored).toEqual([]);
  });

  it('ignores a different city id', () => {
    const { state, ignored } = parse('c=other');
    expect(state.city).toBe(config.id);
    expect(ignored).toContain('c');
  });

  it('an oversize query is dropped whole: defaults and ignored == ["query"]', () => {
    const { state, ignored } = parse('o=41.65,-4.72&' + 'x=1&'.repeat(600));
    expect(state).toEqual(defaultState(city));
    expect(ignored).toEqual(['query']);
  });

  it('clamps the scale to its range and rounds it', () => {
    expect(parse('max=1').state.scale).toBe(5);
    expect(parse('max=100000').state.scale).toBe(120);
    expect(parse('max=29.6').state.scale).toBe(30);
    expect(parse('max=abc').state.scale).toBe(45);
    expect(parse('max=abc').ignored).toContain('max');
  });

  it('keeps only known direction values', () => {
    expect(parse('dir=arrival').state.direction).toBe('arrival');
    const bad = parse('dir=sideways');
    expect(bad.state.direction).toBe('departure');
    expect(bad.ignored).toContain('dir');
  });

  it('filters modes to the transit modes of the city and dedupes', () => {
    expect(parse('modes=bus,bus,teleport,walk,__proto__').state.modes).toEqual(['bus']);
    expect(parse('modes=teleport').state.modes).toEqual([]);
    expect(parse('modes=teleport').ignored).toContain('modes');
  });

  it('filters isochrones to the allowed set, sorted and deduped', () => {
    expect(parse('iso=60,15,15,7,abc,-3').state.isochrones).toEqual([15, 60]);
    expect(parse('iso=7').state.isochrones).toEqual([15, 30]);
    expect(parse('iso=7').ignored).toContain('iso');
  });

  it('uses the first value of a repeated parameter', () => {
    expect(parse('max=20&max=90').state.scale).toBe(20);
  });

  it('ignores an invalid destination but keeps the rest of the state', () => {
    const { state, ignored } = parse('dir=arrival&d=99,99&max=20');
    expect(state.destination).toBeNull();
    expect(state.direction).toBe('arrival');
    expect(state.scale).toBe(20);
    expect(ignored).toContain('d');
  });

  it('survives hostile input without throwing', () => {
    const hostile = [
      '%', '%E0%A4%A', 'o=%00,%00', 'modes=' + 'a,'.repeat(100000), '&'.repeat(5000),
      'iso=' + '1,'.repeat(50000), 'o=' + '9'.repeat(100000), '<script>alert(1)</script>', 'c[]=x&o[]=1',
      { toString() { throw new Error('boom'); } }, 42, ['o=1'],
    ];
    for (const input of hostile) {
      const { state } = parse(input);
      expect(state.origin.every(Number.isFinite)).toBe(true);
      expect(state.scale).toBeGreaterThanOrEqual(5);
      expect(state.scale).toBeLessThanOrEqual(120);
    }
  });

  it('never mutates the defaults (no shared references)', () => {
    const a = parse('').state;
    a.modes.push('x');
    a.isochrones.push(99);
    a.origin[0] = 0;
    expect(parse('').state).toEqual(defaultState(city));
  });
});
