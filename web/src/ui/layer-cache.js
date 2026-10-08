// Geometry of the off-screen street layer. Painting ~120k street segments costs tens of milliseconds, so the layer
// is rendered once into a canvas a bit bigger than the viewport and a pan is just a pixel copy at an integer offset.
// Pure: the renderer owns the canvas, this only decides where things go and when the layer is stale.

/** Extra area on every side, as a share of the viewport. */
export const MARGIN = 0.2;
/** Safari refuses canvases above 16 MP; beyond that the streets are painted directly every frame. */
export const MAX_PIXELS = 16_000_000;

/** Layer centred on `view` for a canvas of `size` ({width, height, dpr} in CSS px), or null when it would be too big. */
export function layerFor(view, size) {
  const pxWidth = Math.round(size.width * (1 + 2 * MARGIN) * size.dpr);
  const pxHeight = Math.round(size.height * (1 + 2 * MARGIN) * size.dpr);
  if (pxWidth * pxHeight > MAX_PIXELS) return null;
  return { cx: view.cx, cy: view.cy, scale: view.scale, dpr: size.dpr, width: size.width, height: size.height, pxWidth, pxHeight };
}

const shift = (layer, view) => [(layer.cx - view.cx) * layer.scale * layer.dpr, -(layer.cy - view.cy) * layer.scale * layer.dpr];

/** Device-pixel position of the layer's top-left corner on the main canvas (integers: no resampling blur). */
export function layerOffset(layer, view, size) {
  const [dx, dy] = shift(layer, view);
  return {
    x: Math.round((size.width * size.dpr) / 2 + dx - layer.pxWidth / 2),
    y: Math.round((size.height * size.dpr) / 2 + dy - layer.pxHeight / 2),
  };
}

/** True while the layer was made for this scale, size and density and still covers the whole viewport. */
export function layerCovers(layer, view, size) {
  if (view.scale !== layer.scale || size.width !== layer.width || size.height !== layer.height || size.dpr !== layer.dpr) return false;
  const [dx, dy] = shift(layer, view);
  return Math.abs(dx) <= MARGIN * layer.width * layer.dpr && Math.abs(dy) <= MARGIN * layer.height * layer.dpr;
}
