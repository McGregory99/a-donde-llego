// The city shown comes from the registered configs and the URL, never from a literal (R1.4).
import { describe, expect, it } from 'vitest';
import { cities, pickCity } from '../../src/cities.js';

const a = { id: 'aa', name: 'A' };
const b = { id: 'bb', name: 'B' };

describe('pickCity', () => {
  it('uses the city named by the c parameter', () => {
    expect(pickCity([a, b], '?c=bb')).toBe(b);
  });

  it('falls back to the first city by id when c is absent or unknown', () => {
    expect(pickCity([b, a], '')).toBe(a);
    expect(pickCity([a, b], '?c=zz')).toBe(a);
  });

  it('throws when no city is registered', () => {
    expect(() => pickCity([], '')).toThrow(/no city/i);
  });
});

describe('registered cities', () => {
  it('are loaded from cities/*.json without the schema', () => {
    expect(cities.length).toBeGreaterThan(0);
    expect(cities.every((c) => typeof c.id === 'string' && c.bbox?.length === 4)).toBe(true);
  });
});
