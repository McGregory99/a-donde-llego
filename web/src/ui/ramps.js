// Heat ramps as data. Every ramp runs near (position 0) -> far (position 1) and loses lightness monotonically, so
// the order survives greyscale and colour-vision deficiency; the far end is dark enough to read on the pale basemap.

/** Candidate ramps, each a list of [position in 0..1, hex]. */
export const RAMPS = {
  // Green -> yellow -> orange -> red -> dark magenta: the familiar traffic-light reading with a lightness step each.
  A: { id: 'A', stops: [[0, '#86cc3f'], [0.25, '#d9a810'], [0.5, '#ee7f22'], [0.75, '#d1312b'], [1, '#78124f']] },
  // Viridis reversed from its green end: perceptually uniform and colour-blind safe, near = green, far = violet.
  B: { id: 'B', stops: [[0, '#a0da39'], [0.25, '#4ac16d'], [0.5, '#1fa187'], [0.75, '#2e6e8e'], [1, '#472d7b']] },
  // One hue (blue) light -> dark: magnitude as a pure sequential ramp, so lightness alone carries the order.
  C: { id: 'C', stops: [[0, '#9fd3f0'], [0.25, '#5eaee0'], [0.5, '#2f80c8'], [0.75, '#1b549b'], [1, '#0c2a60']] },
};

export const DEFAULT_RAMP = 'A';

/** The ramp for a location search string; `?ramp=A|B|C` only counts in dev builds (`dev`), production ignores it. */
export function rampFromSearch(search, dev = false) {
  const id = dev ? new URLSearchParams(search ?? '').get('ramp')?.toUpperCase() : null;
  return RAMPS[id] ?? RAMPS[DEFAULT_RAMP];
}

/** The ramp in use: the default, or the dev-only `?ramp=` override. */
export const ACTIVE_RAMP = rampFromSearch(globalThis.location?.search, Boolean(import.meta.env?.DEV));

export const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

const linear = (channel) => {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/** WCAG relative luminance of a hex colour. */
export function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map(linear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** CIE L* (0..100) of a hex colour. */
export function lightness(hex) {
  const y = luminance(hex);
  return y > 216 / 24389 ? 116 * Math.cbrt(y) - 16 : (y * 24389) / 27;
}

/** WCAG contrast ratio between two hex colours. */
export function contrast(a, b) {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}
