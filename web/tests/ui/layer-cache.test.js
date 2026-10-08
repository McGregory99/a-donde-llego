// Off-screen street layer: panning must be a pixel copy, so the layer is reused while it still covers the view.
import { describe, expect, it } from 'vitest';
import { layerCovers, layerFor, layerOffset } from '../../src/ui/layer-cache.js';

const size = { width: 1000, height: 600, dpr: 2 };
const view = { cx: 100, cy: -50, scale: 0.5 };

describe('layerFor', () => {
  it('covers the viewport plus a margin on every side, in device pixels', () => {
    const layer = layerFor(view, size);
    expect(layer).toMatchObject({ cx: 100, cy: -50, scale: 0.5, dpr: 2 });
    expect(layer.pxWidth).toBe(Math.round(1000 * 1.4 * 2));
    expect(layer.pxHeight).toBe(Math.round(600 * 1.4 * 2));
  });

  it('gives up (null) when the layer would exceed what browsers can allocate as a canvas', () => {
    expect(layerFor(view, { width: 3000, height: 1800, dpr: 2 })).toBeNull();
  });
});

describe('layerOffset', () => {
  const layer = layerFor(view, size);
  it('places the layer centred on the view when nothing moved', () => {
    const { x, y } = layerOffset(layer, view, size);
    expect(x).toBe(Math.round((size.width * size.dpr) / 2 - layer.pxWidth / 2));
    expect(y).toBe(Math.round((size.height * size.dpr) / 2 - layer.pxHeight / 2));
  });

  it('moves with the view in whole device pixels (a pan of 100 css px to the east shifts the layer 200 px left)', () => {
    const base = layerOffset(layer, view, size);
    const moved = layerOffset(layer, { ...view, cx: view.cx + 100 / view.scale }, size);
    expect(moved.x - base.x).toBe(-200);
    expect(Number.isInteger(moved.y)).toBe(true);
    const north = layerOffset(layer, { ...view, cy: view.cy + 50 / view.scale }, size);
    expect(north.y - base.y).toBe(100); // the view moved north: content moves down the screen
  });
});

describe('layerCovers', () => {
  const layer = layerFor(view, size);
  it('holds while the viewport stays inside the margin', () => {
    expect(layerCovers(layer, view, size)).toBe(true);
    expect(layerCovers(layer, { ...view, cx: view.cx + 150 / view.scale }, size)).toBe(true); // 150 < 0.2 * 1000
  });
  it('fails after panning past the margin, zooming or resizing', () => {
    expect(layerCovers(layer, { ...view, cx: view.cx + 250 / view.scale }, size)).toBe(false);
    expect(layerCovers(layer, { ...view, cy: view.cy - 130 / view.scale }, size)).toBe(false); // 130 > 0.2 * 600
    expect(layerCovers(layer, { ...view, scale: 0.51 }, size)).toBe(false);
    expect(layerCovers(layer, view, { ...size, width: 1001 })).toBe(false);
    expect(layerCovers(layer, view, { ...size, dpr: 1 })).toBe(false);
  });
});
