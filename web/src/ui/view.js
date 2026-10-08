// Map view: an equirectangular projection around the city and pan/zoom of the canvas.
// World coordinates are metres, x east and y north. Views are immutable values.

const METRES_PER_DEGREE = 111_320;
export const MIN_ZOOM_FACTOR = 0.5;
export const MAX_ZOOM_FACTOR = 14;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/** Projection with `reference` = [lat, lon] at the world origin. */
export function createProjection(reference) {
  const [lat0, lon0] = reference;
  const lonScale = METRES_PER_DEGREE * Math.cos((lat0 * Math.PI) / 180);
  return {
    toWorld: ([lat, lon]) => [(lon - lon0) * lonScale, (lat - lat0) * METRES_PER_DEGREE],
    toLatLon: ([x, y]) => [lat0 + y / METRES_PER_DEGREE, lon0 + x / lonScale],
  };
}

/** [minX, minY, maxX, maxY] of world `points` grown by `margin` metres, or null when there are none. */
export function boundsOf(points, margin = 0) {
  if (!points.length) return null;
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return [Math.min(...xs) - margin, Math.min(...ys) - margin, Math.max(...xs) + margin, Math.max(...ys) + margin];
}

/** View showing `bounds` = [minX, minY, maxX, maxY] centred in a canvas of `size`, with `pad` pixels around. */
export function fitView(bounds, size, pad = 40) {
  const [minX, minY, maxX, maxY] = bounds;
  const scale = Math.min((size.width - pad * 2) / (maxX - minX), (size.height - pad * 2) / (maxY - minY));
  return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, scale, fitScale: scale };
}

/** Screen pixel [x, y] of a world point. */
export function toScreen(view, size, world) {
  return [size.width / 2 + (world[0] - view.cx) * view.scale, size.height / 2 - (world[1] - view.cy) * view.scale];
}

/** World point under a screen pixel. */
export function toWorldPoint(view, size, screen) {
  return [view.cx + (screen[0] - size.width / 2) / view.scale, view.cy - (screen[1] - size.height / 2) / view.scale];
}

/** Zooms by `factor` around a screen point, which stays fixed; the scale is clamped around the fit scale. */
export function zoomAt(view, size, factor, screenX, screenY) {
  const before = toWorldPoint(view, size, [screenX, screenY]);
  const scale = clamp(view.scale * factor, view.fitScale * MIN_ZOOM_FACTOR, view.fitScale * MAX_ZOOM_FACTOR);
  const zoomed = { ...view, scale };
  const after = toWorldPoint(zoomed, size, [screenX, screenY]);
  return { ...zoomed, cx: view.cx + before[0] - after[0], cy: view.cy + before[1] - after[1] };
}

/** Drags the map by a screen delta (the world follows the pointer). */
export function panBy(view, dx, dy) {
  return { ...view, cx: view.cx - dx / view.scale, cy: view.cy + dy / view.scale };
}

/** Rescales a view when the canvas changes size so the same area stays in view. */
export function resizeView(view, oldSize, newSize) {
  const ratio = newSize.width / oldSize.width;
  return { ...view, scale: view.scale * ratio, fitScale: view.fitScale * ratio };
}
