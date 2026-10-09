// R4.3: green -> red colour ramp; beyond the scale the colour fades out.
import { describe, expect, it } from 'vitest';
import { BEYOND_FADE, heatColor, legendGradient, paletteColor } from '../../src/ui/color.js';
import { RAMP } from '../../src/ui/ramps.js';

const rgbOf = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const stops = RAMP.stops;
const first = rgbOf(stops[0][1]);
const last = rgbOf(stops.at(-1)[1]);

describe('paletteColor', () => {
  it('follows the active ramp from its first to its last stop', () => {
    expect(paletteColor(0)).toEqual(first);
    expect(paletteColor(1)).toEqual(last);
    expect(paletteColor(stops[2][0])).toEqual(rgbOf(stops[2][1]));
  });

  it('interpolates between stops', () => {
    const mid = (stops[0][0] + stops[1][0]) / 2;
    expect(paletteColor(mid)).toEqual(rgbOf(stops[0][1]).map((c, i) => Math.round((c + rgbOf(stops[1][1])[i]) / 2)));
  });

  it('clamps outside [0, 1]', () => {
    expect(paletteColor(-3)).toEqual(paletteColor(0));
    expect(paletteColor(9)).toEqual(paletteColor(1));
  });
});

describe('heatColor', () => {
  it('is opaque within the scale and uses the ramp position minutes / max', () => {
    expect(heatColor(0, 45)).toEqual([...first, 255]);
    expect(heatColor(45, 45)).toEqual([...last, 255]);
    expect(heatColor(15, 30)).toEqual([...paletteColor(0.5), 255]);
  });

  it('fades out beyond the scale and vanishes past the fade band', () => {
    const half = heatColor(45 * (1 + BEYOND_FADE / 2), 45);
    expect(half.slice(0, 3)).toEqual(paletteColor(1));
    expect(half[3]).toBeGreaterThan(100);
    expect(half[3]).toBeLessThan(155);
    expect(heatColor(45 * (1 + BEYOND_FADE) + 1, 45)[3]).toBe(0);
  });

  it('paints nothing for unreachable (NaN or infinite) times', () => {
    expect(heatColor(NaN, 45)[3]).toBe(0);
    expect(heatColor(Infinity, 45)[3]).toBe(0);
  });
});

describe('legendGradient', () => {
  it('is a CSS linear gradient over the same stops as the map', () => {
    const css = legendGradient();
    expect(css).toMatch(/^linear-gradient\(90deg, /);
    expect(css).toContain(`rgb(${first.join(', ')}) 0%`);
    expect(css).toContain(`rgb(${last.join(', ')}) 100%`);
  });
});
