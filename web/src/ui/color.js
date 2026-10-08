// Colour ramp of the heat map: near -> far along the active ramp (ramps.js), fading out beyond the scale (raster only).
import { ACTIVE_RAMP, hexToRgb } from './ramps.js';

// [position in 0..1, [r, g, b]] of the active ramp (ramps.js).
export const PALETTE = ACTIVE_RAMP.stops.map(([position, hex]) => [position, hexToRgb(hex)]);

/** Share of the scale over which the colour fades out beyond its maximum. */
export const BEYOND_FADE = 0.15;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/** [r, g, b] at position `t` of the ramp (clamped to 0..1). */
export function paletteColor(t) {
  const position = clamp(t, 0, 1);
  for (let i = 1; i < PALETTE.length; i += 1) {
    const [stop, color] = PALETTE[i];
    if (position <= stop) {
      const [previousStop, previousColor] = PALETTE[i - 1];
      const mix = (position - previousStop) / (stop - previousStop);
      return previousColor.map((channel, c) => Math.round(channel + (color[c] - channel) * mix));
    }
  }
  return [...PALETTE[PALETTE.length - 1][1]];
}

/** [r, g, b, a] for a travel time against the scale maximum; a = 0 when nothing should be painted. */
export function heatColor(minutes, maxMinutes) {
  if (!Number.isFinite(minutes)) return [0, 0, 0, 0];
  const t = minutes / maxMinutes;
  const alpha = t <= 1 ? 255 : Math.round(clamp(1 - (t - 1) / BEYOND_FADE, 0, 1) * 255);
  if (alpha === 0) return [0, 0, 0, 0];
  return [...paletteColor(t), alpha];
}

/** CSS gradient with the same stops as the map, for the legend bar. */
export function legendGradient() {
  const stops = PALETTE.map(([t, [r, g, b]]) => `rgb(${r}, ${g}, ${b}) ${Math.round(t * 100)}%`);
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}
