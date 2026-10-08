// R4.3: green -> red colour ramp; beyond the scale the colour fades out.
import { describe, expect, it } from 'vitest';
import { BEYOND_FADE, heatColor, legendGradient, paletteColor } from '../../src/ui/color.js';

describe('paletteColor', () => {
  it('runs green at 0 to red at 1 through yellow', () => {
    expect(paletteColor(0)).toEqual([47, 150, 18]);
    expect(paletteColor(0.5)).toEqual([226, 228, 120]);
    expect(paletteColor(1)).toEqual([226, 120, 120]);
  });

  it('interpolates between stops', () => {
    expect(paletteColor(0.125)).toEqual([87, 175, 49]);
  });

  it('clamps outside [0, 1]', () => {
    expect(paletteColor(-3)).toEqual(paletteColor(0));
    expect(paletteColor(9)).toEqual(paletteColor(1));
  });
});

describe('heatColor', () => {
  it('is opaque within the scale and uses the ramp position minutes / max', () => {
    expect(heatColor(0, 45)).toEqual([47, 150, 18, 255]);
    expect(heatColor(45, 45)).toEqual([226, 120, 120, 255]);
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
    expect(css).toContain('rgb(47, 150, 18) 0%');
    expect(css).toContain('rgb(226, 120, 120) 100%');
  });
});
