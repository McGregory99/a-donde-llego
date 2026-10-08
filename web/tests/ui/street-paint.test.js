// Street painting rules (pure): colour buckets per edge, zoom-dependent widths and detail.
import { describe, expect, it } from 'vitest';
import { decodeWalk } from '../../src/core/streets.js';
import {
  BASE_STYLE, STREET_LEVELS, bucketColor, edgeBuckets, pathsVisible, streetWidth, tickHalfPx, ticksVisible,
} from '../../src/ui/street-paint.js';

// 0 -(main)- 1 -(minor)- 2 -(path)- 3, and an island edge 4-5 nobody reaches.
const walk = decodeWalk({
  schema: 1, scale: 100000, n: 6,
  lat: [4160000, 50, 50, 50, 500, 50], lon: [-470000, 0, 0, 0, 0, 0],
  deg: [1, 1, 1, 0, 1, 0], to: [1, 1, 1, 1], m: [50, 50, 50, 50], cls: [2, 1, 0, 1], geo: [0, 0, 0, 0], glat: [], glon: [],
});

describe('edgeBuckets', () => {
  it('colours an edge by the mean of its two node times, in equal steps of the scale', () => {
    const buckets = edgeBuckets(walk, Float64Array.from([0, 2, 4, 6, Infinity, Infinity]), 45);
    expect(buckets[0]).toBeGreaterThanOrEqual(0);
    expect(buckets[0]).toBeLessThan(buckets[1]);
    expect(buckets[1]).toBeLessThanOrEqual(buckets[2]);
  });

  it('leaves edges with an unreached end, or beyond the scale and its fade, in the neutral style (-1)', () => {
    const buckets = edgeBuckets(walk, Float64Array.from([0, 10, 60, 60, Infinity, 5]), 45);
    expect(buckets[0]).toBeGreaterThanOrEqual(0);
    expect(buckets[1]).toBeGreaterThanOrEqual(0); // 10..60 straddles the scale: its mean (35) is inside
    expect(buckets[2]).toBe(-1); // 60..60 is beyond the scale and its fade band
    expect(buckets[3]).toBe(-1); // 4 -> 5: node 4 is unreached
  });

  it('never exceeds the last level', () => {
    const buckets = edgeBuckets(walk, Float64Array.from([51, 51, 51, 51, 0, 0]), 45);
    expect(Math.max(...buckets)).toBeLessThan(STREET_LEVELS);
  });
});

describe('bucketColor', () => {
  it('walks from green to red and fades beyond the scale', () => {
    const near = bucketColor(0, 45);
    const far = bucketColor(STREET_LEVELS - 1, 45);
    expect(near).toMatch(/^rgba\(\d+, \d+, \d+, [\d.]+\)$/);
    expect(near).not.toBe(far);
  });
});

describe('zoom dependent style', () => {
  it('main streets are wider than minor ones, which are wider than paths', () => {
    for (const scale of [0.05, 0.3, 2]) {
      expect(streetWidth(2, scale)).toBeGreaterThanOrEqual(streetWidth(1, scale));
      expect(streetWidth(1, scale)).toBeGreaterThanOrEqual(streetWidth(0, scale));
    }
  });
  it('widths grow with the zoom but stay in bounds', () => {
    expect(streetWidth(1, 2)).toBeGreaterThan(streetWidth(1, 0.05));
    expect(streetWidth(2, 50)).toBeLessThanOrEqual(8);
    expect(streetWidth(0, 0.001)).toBeGreaterThanOrEqual(0.3);
  });
  it('paths are only drawn once zoomed in enough to tell them apart', () => {
    expect(pathsVisible(0.03)).toBe(false);
    expect(pathsVisible(0.5)).toBe(true);
  });
  it('has one grey base style per road class, paths dashed', () => {
    expect(BASE_STYLE).toHaveLength(3);
    expect(BASE_STYLE[0].dash).toBe(true);
    expect(BASE_STYLE[2].dash).toBe(false);
  });
});

describe('isochrone ticks', () => {
  it('are a few pixels long far out and stay readable up close, never huge', () => {
    expect(tickHalfPx(0.01)).toBeGreaterThanOrEqual(2);
    expect(tickHalfPx(0.05)).toBeLessThan(tickHalfPx(5));
    expect(tickHalfPx(100)).toBeLessThanOrEqual(7);
  });
  it('are hidden at whole-city zoom, where thousands of them would pile up into blobs', () => {
    expect(ticksVisible(0.05)).toBe(false);
    expect(ticksVisible(0.4)).toBe(true);
  });
});
