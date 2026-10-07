// Heat raster: travel-time grid -> RGBA pixels (bilinear upsampling). Pure; the canvas only blits it.
import { heatColor } from './color.js';

const NEIGHBOURS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const LUT_SIZE = 512;
const LUT_RANGE = 1.15; // ramp positions covered by the lookup table: the scale plus its fade band

/** Fills NaN cells with the mean of their non-NaN neighbours, one cell outward per pass. */
export function fillGaps(values, cols, rows, passes) {
  let filled = Float32Array.from(values);
  for (let pass = 0; pass < passes; pass += 1) {
    const source = Float32Array.from(filled);
    for (let index = 0; index < source.length; index += 1) {
      if (!Number.isNaN(source[index])) continue;
      const row = Math.floor(index / cols);
      const col = index % cols;
      let sum = 0;
      let count = 0;
      for (const [dr, dc] of NEIGHBOURS) {
        const r = row + dr;
        const c = col + dc;
        if (r < 0 || c < 0 || r >= rows || c >= cols) continue;
        const value = source[r * cols + c];
        if (!Number.isNaN(value)) {
          sum += value;
          count += 1;
        }
      }
      if (count) filled[index] = sum / count;
    }
  }
  return filled;
}

/**
 * RGBA image of the grid, `upsample` pixels per cell side, row 0 at the south edge (the canvas draws it
 * with the y axis flipped). Cells with no data stay transparent unless a reachable cell is close enough.
 */
export function heatPixels(times, cols, rows, maxMinutes, upsample = 3) {
  const width = cols * upsample;
  const height = rows * upsample;
  const data = new Uint8ClampedArray(width * height * 4);
  // Extend values one cell off the land so smoothing does not darken the coast.
  const filled = fillGaps(times, cols, rows, 2);
  const lut = Array.from({ length: LUT_SIZE }, (_, i) => heatColor(((i / (LUT_SIZE - 1)) * LUT_RANGE) * maxMinutes, maxMinutes));
  const toLut = (LUT_SIZE - 1) / (maxMinutes * LUT_RANGE);
  const step = 1 / upsample;

  for (let y = 0; y < height; y += 1) {
    const gy = (y + 0.5) * step - 0.5;
    const row0 = clamp(Math.floor(gy), 0, rows - 1);
    const row1 = Math.min(row0 + 1, rows - 1);
    const ty = clamp(gy - row0, 0, 1);
    for (let x = 0; x < width; x += 1) {
      const gx = (x + 0.5) * step - 0.5;
      const col0 = clamp(Math.floor(gx), 0, cols - 1);
      const col1 = Math.min(col0 + 1, cols - 1);
      const tx = clamp(gx - col0, 0, 1);
      let sum = 0;
      let weight = 0;
      for (const [r, c, w] of [
        [row0, col0, (1 - tx) * (1 - ty)],
        [row0, col1, tx * (1 - ty)],
        [row1, col0, (1 - tx) * ty],
        [row1, col1, tx * ty],
      ]) {
        const value = filled[r * cols + c];
        if (!Number.isNaN(value)) {
          sum += value * w;
          weight += w;
        }
      }
      if (weight < 0.25) continue;
      const index = Math.round((sum / weight) * toLut);
      if (index >= LUT_SIZE) continue;
      data.set(lut[index], (y * width + x) * 4);
    }
  }
  return { width, height, data };
}
