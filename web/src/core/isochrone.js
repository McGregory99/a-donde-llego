// Isochrone contours from a travel-time raster: 3x3 smoothing then marching squares.
// Ported from the upstream canvas app (web/upstream/site/app.js), minus the canvas.

/** Weighted 3x3 mean (centre x2) over reachable cells; NaN cells stay NaN. */
export function smoothGrid(times, cols, rows) {
  const out = new Float32Array(times.length).fill(NaN);
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      if (Number.isNaN(times[row * cols + col])) continue;
      let sum = 0;
      let weight = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const r = row + dy;
          const c = col + dx;
          if (r < 0 || c < 0 || r >= rows || c >= cols) continue;
          const value = times[r * cols + c];
          if (Number.isNaN(value)) continue;
          const w = dx === 0 && dy === 0 ? 2 : 1;
          sum += value * w;
          weight += w;
        }
      }
      out[row * cols + col] = sum / weight;
    }
  }
  return out;
}

/** Marching squares on cell centres: segments [[lat, lon], [lat, lon]] where the raster crosses `threshold`. */
function contourSegments(grid, smooth, threshold) {
  const { cols, rows, dLat, dLon } = grid;
  const [west, south] = grid.bbox;
  const value = (row, col) => {
    const v = smooth[row * cols + col];
    return Number.isNaN(v) ? Infinity : v;
  };
  const centre = (row, col) => [south + (row + 0.5) * dLat, west + (col + 0.5) * dLon];
  const between = (pa, va, pb, vb) => {
    const t = Number.isFinite(va) && Number.isFinite(vb) ? Math.min(1, Math.max(0, (threshold - va) / (vb - va))) : 0.5;
    return [pa[0] + (pb[0] - pa[0]) * t, pa[1] + (pb[1] - pa[1]) * t];
  };

  const segments = [];
  for (let row = 0; row < rows - 1; row += 1) {
    for (let col = 0; col < cols - 1; col += 1) {
      const corners = [
        [centre(row, col), value(row, col)],
        [centre(row, col + 1), value(row, col + 1)],
        [centre(row + 1, col + 1), value(row + 1, col + 1)],
        [centre(row + 1, col), value(row + 1, col)],
      ];
      const inside = corners.map(([, v]) => v <= threshold);
      const crossings = [];
      for (let k = 0; k < 4; k += 1) {
        const a = corners[k];
        const b = corners[(k + 1) % 4];
        if (inside[k] !== inside[(k + 1) % 4]) crossings.push(between(a[0], a[1], b[0], b[1]));
      }
      if (crossings.length === 2) segments.push(crossings);
      else if (crossings.length === 4) segments.push([crossings[0], crossings[1]], [crossings[2], crossings[3]]);
    }
  }
  return segments;
}

/** Contour segments per threshold: `{ [threshold]: segments }`. */
export function isochrones(grid, times, thresholds) {
  const smooth = smoothGrid(times, grid.cols, grid.rows);
  return Object.fromEntries(thresholds.map((t) => [t, contourSegments(grid, smooth, t)]));
}
