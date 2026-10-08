// Candidate heat ramps: data-driven, perceptually ordered and readable against the basemap.
import { describe, expect, it } from 'vitest';
import { contrast, lightness, rampFromSearch, RAMPS, DEFAULT_RAMP } from '../../src/ui/ramps.js';
import { COLORS } from '../../src/ui/renderer.js';

const hexes = (ramp) => ramp.stops.map(([, hex]) => hex);

describe('ramps', () => {
  it('defines candidates A, B and C and defaults to A', () => {
    expect(Object.keys(RAMPS)).toEqual(['A', 'B', 'C']);
    expect(DEFAULT_RAMP).toBe('A');
  });

  it.each(Object.keys(RAMPS))('ramp %s runs near -> far over 0..1 with strictly decreasing lightness', (id) => {
    const { stops } = RAMPS[id];
    expect(stops[0][0]).toBe(0);
    expect(stops.at(-1)[0]).toBe(1);
    const levels = hexes(RAMPS[id]).map(lightness);
    for (let i = 1; i < levels.length; i += 1) expect(levels[i]).toBeLessThan(levels[i - 1] - 3);
  });

  it.each(Object.keys(RAMPS))('ramp %s far end contrasts with the land (>= 7:1) and near end stays visible (>= 1.3:1)', (id) => {
    const colors = hexes(RAMPS[id]);
    expect(contrast(colors.at(-1), COLORS.land)).toBeGreaterThanOrEqual(7);
    expect(contrast(colors[0], COLORS.land)).toBeGreaterThanOrEqual(1.3);
  });

  it('A goes green -> yellow -> orange -> red -> dark magenta', () => {
    const [green, yellow, orange, red, magenta] = hexes(RAMPS.A);
    const hue = (hex) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
      return (Math.atan2(Math.sqrt(3) * (g - b), 2 * r - g - b) * 180) / Math.PI;
    };
    expect(hue(green)).toBeGreaterThan(70);
    expect(hue(green)).toBeLessThan(110);
    expect(hue(yellow)).toBeGreaterThan(35);
    expect(hue(orange)).toBeLessThan(35);
    expect(hue(red)).toBeLessThan(10);
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(magenta.slice(i, i + 2), 16));
    expect(r).toBeGreaterThan(g); // reddish-purple: red and blue dominate green
    expect(b).toBeGreaterThan(g);
  });

  it('B keeps a viridis-like ending in dark violet', () => {
    expect(hexes(RAMPS.B).at(-1)).toBe('#472d7b');
  });
});

describe('rampFromSearch', () => {
  it('ignores ?ramp= in production builds', () => {
    expect(rampFromSearch('?ramp=B', false)).toBe(RAMPS[DEFAULT_RAMP]);
  });
  it('honours ?ramp= (case-insensitive) in dev builds and falls back on unknown ids', () => {
    expect(rampFromSearch('?c=x&ramp=b', true)).toBe(RAMPS.B);
    expect(rampFromSearch('?ramp=Z', true)).toBe(RAMPS[DEFAULT_RAMP]);
    expect(rampFromSearch('', true)).toBe(RAMPS[DEFAULT_RAMP]);
  });
});
