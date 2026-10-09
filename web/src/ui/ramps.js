// Heat ramps as data. Every ramp runs near (position 0) -> far (position 1) and loses lightness monotonically, so
// the order survives greyscale and colour-vision deficiency; the far end is dark enough to read on the pale basemap.

/** The heat ramp: [position in 0..1, hex] stops. Viridis reversed from its green end: perceptually uniform and
 *  colour-blind safe, near = green, far = violet. */
export const RAMP = {
  id: 'B',
  stops: [[0, '#a0da39'], [0.25, '#4ac16d'], [0.5, '#1fa187'], [0.75, '#2e6e8e'], [1, '#472d7b']],
};

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
