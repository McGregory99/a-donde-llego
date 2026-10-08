// Heat raster: gap filling, bilinear upsampling and colouring of the travel-time grid.
import { describe, expect, it } from 'vitest';
import { heatColor } from '../../src/ui/color.js';
import { fillGaps, heatPixels } from '../../src/ui/heat.js';

const NaNs = (n) => new Float32Array(n).fill(NaN);
const pixel = (image, x, y) => Array.from(image.data.slice((y * image.width + x) * 4, (y * image.width + x) * 4 + 4));

describe('fillGaps', () => {
  it('fills a hole with the mean of its neighbours and leaves values alone', () => {
    const values = Float32Array.from([10, 20, 30, 40, NaN, 60, 70, 80, 90]);
    const filled = fillGaps(values, 3, 3, 1);
    expect(filled[4]).toBe((20 + 40 + 60 + 80) / 4);
    expect(filled[0]).toBe(10);
  });

  it('spreads one cell per pass and keeps unreachable areas empty', () => {
    const values = NaNs(25);
    values[0] = 5;
    const one = fillGaps(values, 5, 5, 1);
    expect(one[1]).toBe(5);
    expect(one[2]).toBeNaN();
    expect(fillGaps(NaNs(4), 2, 2, 3).every(Number.isNaN)).toBe(true);
  });
});

describe('heatPixels', () => {
  it('upsamples to cols*k by rows*k RGBA pixels', () => {
    const image = heatPixels(Float32Array.from([1, 2, 3, 4]), 2, 2, 45, 3);
    expect(image.width).toBe(6);
    expect(image.height).toBe(6);
    expect(image.data.length).toBe(6 * 6 * 4);
  });

  it('colours a uniform grid with the ramp colour of its value', () => {
    const image = heatPixels(new Float32Array(9).fill(0), 3, 3, 45, 1);
    expect(pixel(image, 1, 1)).toEqual(heatColor(0, 45));
  });

  it('leaves cells nowhere near a reachable one transparent', () => {
    const times = NaNs(10 * 10);
    times[0] = 0;
    const image = heatPixels(times, 10, 10, 45, 1);
    expect(pixel(image, 0, 0)[3]).toBe(255);
    expect(pixel(image, 9, 9)).toEqual([0, 0, 0, 0]);
  });

  it('rescales colours when the maximum changes (R4.3 scale slider)', () => {
    const times = new Float32Array(9).fill(15);
    const at45 = pixel(heatPixels(times, 3, 3, 45, 1), 1, 1);
    const at30 = pixel(heatPixels(times, 3, 3, 30, 1), 1, 1);
    expect(at45).not.toEqual(at30);
    expect(at30).toEqual(heatColor(15, 30));
  });

  it('does not colour times far beyond the scale', () => {
    const image = heatPixels(new Float32Array(9).fill(500), 3, 3, 45, 1);
    expect(pixel(image, 1, 1)[3]).toBe(0);
  });
});
