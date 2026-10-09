// Heat ramp: data-driven, perceptually ordered and readable against the basemap.
import { describe, expect, it } from 'vitest';
import { contrast, lightness, RAMP } from '../../src/ui/ramps.js';
import { COLORS } from '../../src/ui/renderer.js';

const hexes = RAMP.stops.map(([, hex]) => hex);

describe('ramp', () => {
  it('runs near -> far over 0..1 with strictly decreasing lightness', () => {
    const { stops } = RAMP;
    expect(stops[0][0]).toBe(0);
    expect(stops.at(-1)[0]).toBe(1);
    const levels = hexes.map(lightness);
    for (let i = 1; i < levels.length; i += 1) expect(levels[i]).toBeLessThan(levels[i - 1] - 3);
  });

  it('far end contrasts with the land (>= 7:1) and near end stays visible (>= 1.3:1)', () => {
    expect(contrast(hexes.at(-1), COLORS.land)).toBeGreaterThanOrEqual(7);
    expect(contrast(hexes[0], COLORS.land)).toBeGreaterThanOrEqual(1.3);
  });

  it('is viridis-like, ending in dark violet', () => {
    expect(hexes.at(-1)).toBe('#472d7b');
  });
});
