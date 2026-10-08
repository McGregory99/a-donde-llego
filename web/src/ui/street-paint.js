// Street painting rules, pure: which colour bucket an edge falls in, and widths/detail per zoom.
// The renderer only turns these into canvas paths; the choices live (and are tested) here.
import { BEYOND_FADE, heatColor } from './color.js';

/** Colour buckets across 0..(1 + BEYOND_FADE) x the scale; a stroke per bucket and road class keeps frames cheap. */
export const STREET_LEVELS = 48;
const SPAN = 1 + BEYOND_FADE;

/** Grey base style per road class (0 path, 1 minor, 2 main): the streets before they get a travel time. */
export const BASE_STYLE = [
  { color: '#aaa79f', dash: true },
  { color: '#bdbab2', dash: false },
  { color: '#a9a69e', dash: false },
];

// Physical width in metres, clamped in pixels so streets stay hairlines far out and never become ribbons close up.
const WIDTH = [
  { metres: 3, min: 0.35, max: 1.6 },
  { metres: 6, min: 0.55, max: 4 },
  { metres: 11, min: 0.9, max: 7 },
];
/** Metres per pixel below which footpaths are left out (zoomed out they are only noise). */
const PATHS_FROM_SCALE = 0.12;

/** Stroke width in pixels of road class `cls` at `scale` pixels per metre. */
export function streetWidth(cls, scale) {
  const { metres, min, max } = WIDTH[cls] ?? WIDTH[1];
  return Math.min(max, Math.max(min, metres * scale));
}

/** True when footpaths (class 0) are drawn at `scale` pixels per metre. */
export const pathsVisible = (scale) => scale >= PATHS_FROM_SCALE;

/**
 * Colour bucket (0..STREET_LEVELS-1) of every edge, or -1 for the neutral base style: the mean of the times at
 * its two nodes (an edge is at most ~60 m, so under a minute of walking separates its ends), -1 when an end is
 * unreached or the mean lies beyond the scale and its fade band.
 */
export function edgeBuckets(walk, times, maxMinutes) {
  const buckets = new Int8Array(walk.edges).fill(-1);
  const limit = maxMinutes * SPAN;
  for (let e = 0; e < walk.edges; e += 1) {
    const a = times[walk.edgeA[e]];
    const b = times[walk.edgeB[e]];
    if (!(a < Infinity) || !(b < Infinity)) continue;
    const mean = (a + b) / 2;
    if (mean > limit) continue;
    buckets[e] = Math.min(STREET_LEVELS - 1, Math.floor((mean / limit) * STREET_LEVELS));
  }
  return buckets;
}

/** CSS colour of a bucket: the heat ramp at its centre, fading out past the scale. */
export function bucketColor(bucket, maxMinutes) {
  const [r, g, b, a] = heatColor(((bucket + 0.5) / STREET_LEVELS) * maxMinutes * SPAN, maxMinutes);
  return `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(3)})`;
}

const TICK_METRES = 45; // half length of an isochrone tick across a street (see core/street-contours.js)

/** Half length in pixels of an isochrone tick at `scale` pixels per metre: its real length, kept between 2 and 7 px. */
export const tickHalfPx = (scale) => Math.min(7, Math.max(2, TICK_METRES * scale));

const TICKS_FROM_SCALE = 0.15; // pixels per metre: about 8 km across a laptop screen

/** True when isochrone ticks are drawn: zoomed out, the street colours already show the fronts. */
export const ticksVisible = (scale) => scale >= TICKS_FROM_SCALE;
