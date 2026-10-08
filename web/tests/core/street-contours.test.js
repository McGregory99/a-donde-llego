// Isochrone fronts on the street network: a tick across every street that crosses the threshold.
import { describe, expect, it } from 'vitest';
import { streetContours } from '../../src/core/street-contours.js';
import { decodeWalk } from '../../src/core/streets.js';
import { distanceM } from '../../src/core/geo.js';

// A straight street along a meridian: nodes every 100 m (0.0009 degrees is about 100 m).
const walk = decodeWalk({
  schema: 1, scale: 100000, n: 4,
  lat: [4160000, 90, 90, 90], lon: [-470000, 0, 0, 0],
  deg: [1, 1, 1, 0], to: [1, 1, 1], m: [100, 100, 100], cls: [1, 1, 1], geo: [0, 0, 0], glat: [], glon: [],
});

describe('streetContours', () => {
  it('puts one tick where the street crosses the threshold, between the two nodes it falls in', () => {
    const times = Float64Array.from([0, 10, 20, 30]);
    const { 15: ticks } = streetContours(walk, times, [15]);
    expect(ticks).toHaveLength(1);
    const [a, b] = ticks[0];
    const middle = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    expect(middle[0]).toBeGreaterThan(walk.lat[1]);
    expect(middle[0]).toBeLessThan(walk.lat[2]);
    expect(middle[0]).toBeCloseTo((walk.lat[1] + walk.lat[2]) / 2, 6); // 15 is half way between 10 and 20
  });

  it('draws the tick across the street (perpendicular), with a fixed length', () => {
    const [[a, b]] = streetContours(walk, Float64Array.from([0, 10, 20, 30]), [15])[15];
    expect(Math.abs(a[0] - b[0])).toBeLessThan(1e-9); // the street runs north-south, the tick east-west
    expect(distanceM(a, b)).toBeGreaterThan(40);
    expect(distanceM(a, b)).toBeLessThan(120);
  });

  it('ignores edges that never reach the threshold or are already entirely beyond it', () => {
    expect(streetContours(walk, Float64Array.from([0, 1, 2, 3]), [15])[15]).toEqual([]);
    expect(streetContours(walk, Float64Array.from([20, 21, 22, 23]), [15])[15]).toEqual([]);
  });

  it('does not invent a front where the walking limit cuts the network (unreached neighbour)', () => {
    expect(streetContours(walk, Float64Array.from([0, 10, Infinity, Infinity]), [15])[15]).toEqual([]);
  });

  it('gives one list per requested threshold and none when nothing is requested', () => {
    expect(Object.keys(streetContours(walk, Float64Array.from([0, 10, 20, 30]), [15, 25]))).toEqual(['15', '25']);
    expect(streetContours(walk, Float64Array.from([0, 10, 20, 30]), [])).toEqual({});
  });
});
