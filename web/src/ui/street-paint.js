// Street painting rules, pure: which colour bucket an edge falls in, and widths/detail per zoom.
// The renderer only turns these into canvas paths; the choices live (and are tested) here.
import { paletteColor } from './color.js';

/** Colour buckets across 0..the scale; a stroke per bucket and road class keeps frames cheap. */
export const STREET_LEVELS = 48;

/** Light neutral base style per road class (0 path, 1 minor, 2 main): streets without a travel time, kept quiet. */
export const BASE_STYLE = [
  { color: '#cfccc4', dash: true },
  { color: '#d9d6ce', dash: false },
  { color: '#cdcac2', dash: false },
];

/** Casing around coloured streets: a thin darker outline (pixels per side) so they stand out on the basemap. */
export const CASING_PX = 0.7;
export const CASING_COLOR = 'rgba(70, 58, 48, 0.5)';

// Physical width in metres, clamped in pixels so streets stay hairlines far out and never become ribbons close up.
const WIDTH = [
  { metres: 3, min: 0.35, max: 1.6 },
  { metres: 6, min: 0.55, max: 4 },
  { metres: 11, min: 0.9, max: 7 },
];
// Coloured streets are always wider than base ones, so the heat reads at every zoom.
const COLORED_WIDTH = [
  { metres: 4, min: 1.1, max: 2.4 },
  { metres: 8, min: 1.5, max: 5.5 },
  { metres: 13, min: 2.1, max: 9 },
];
/** Metres per pixel below which footpaths are left out (zoomed out they are only noise). */
const PATHS_FROM_SCALE = 0.12;

/** Stroke width in pixels of road class `cls` at `scale` pixels per metre. */
export function streetWidth(cls, scale) {
  const { metres, min, max } = WIDTH[cls] ?? WIDTH[1];
  return Math.min(max, Math.max(min, metres * scale));
}

/** Stroke width in pixels of a coloured (travel-time) street of class `cls`, excluding its casing. */
export function coloredStreetWidth(cls, scale) {
  const { metres, min, max } = COLORED_WIDTH[cls] ?? COLORED_WIDTH[1];
  return Math.min(max, Math.max(min, metres * scale));
}

/** True when footpaths (class 0) are drawn at `scale` pixels per metre. */
export const pathsVisible = (scale) => scale >= PATHS_FROM_SCALE;

/**
 * Colour bucket (0..STREET_LEVELS-1) of every edge, or -1 for the neutral base style: the mean of the times at
 * its two nodes (an edge is at most ~60 m, so under a minute of walking separates its ends), -1 when an end is
 * unreached or the mean lies beyond the scale.
 */
export function edgeBuckets(walk, times, maxMinutes) {
  const buckets = new Int8Array(walk.edges).fill(-1);
  const limit = maxMinutes;
  for (let e = 0; e < walk.edges; e += 1) {
    const a = times[walk.edgeA[e]];
    const b = times[walk.edgeB[e]];
    if (!(a < Infinity) || !(b < Infinity)) continue;
    const mean = (a + b) / 2;
    if (mean >= limit) continue;
    buckets[e] = Math.min(STREET_LEVELS - 1, Math.floor((mean / limit) * STREET_LEVELS));
  }
  return buckets;
}

/** Opaque CSS colour of a bucket: the active ramp at its centre. */
export function bucketColor(bucket) {
  const [r, g, b] = paletteColor((bucket + 0.5) / STREET_LEVELS);
  return `rgb(${r}, ${g}, ${b})`;
}
