// @vitest-environment jsdom
// The renderer paints streets through an off-screen layer and then draws bus lines in map space: the canvas
// transform must be the map one again by then (a stale identity transform once drew lines as huge bands).
import { beforeEach, describe, expect, it } from 'vitest';
import { decodeWalk } from '../../src/core/streets.js';
import { createRenderer } from '../../src/ui/renderer.js';
import { createProjection } from '../../src/ui/view.js';

class FakePath {
  constructor() { this.ops = []; }
  moveTo(x, y) { this.ops.push(['m', x, y]); }
  lineTo(x, y) { this.ops.push(['l', x, y]); }
  rect() {}
  closePath() {}
}

/** Recording 2D context: tracks the current transform and every stroke with the transform in force. */
function fakeContext(log) {
  const state = { t: [1, 0, 0, 1, 0, 0], stack: [] };
  const base = {
    setTransform: (...t) => { state.t = t; },
    save: () => state.stack.push([...state.t]),
    restore: () => { state.t = state.stack.pop() ?? state.t; },
    stroke: (path) => log.push({ a: state.t[0], path }),
    measureText: () => ({ width: 10 }),
    createImageData: () => ({}),
  };
  return new Proxy(base, { get: (target, key) => (key in target ? target[key] : () => {}), set: () => true });
}

describe('renderer street layer', () => {
  const strokes = [];
  beforeEach(() => {
    strokes.length = 0;
    globalThis.Path2D = FakePath;
    HTMLCanvasElement.prototype.getContext = function getContext() {
      this.fake ??= fakeContext(strokes);
      return this.fake;
    };
  });

  const walk = decodeWalk({
    schema: 1, scale: 100000, n: 2, lat: [4150000, 100], lon: [-480000, 100], deg: [1, 0], to: [1], m: [140], cls: [2], geo: [0], glat: [], glon: [],
    stops: { node: [], snap_m: [] },
  });
  const projection = createProjection([41.5, -4.8]);
  const lineStart = projection.toWorld([41.5005, -4.7995]);
  const data = {
    boundary: { polygons: [] }, basemap: { water: [], parks: [] },
    lines: { lines: [{ id: 'R1:0', points: [[41.5005, -4.7995], [41.5015, -4.7985]] }] },
  };
  const make = () => createRenderer(document.createElement('canvas'), {
    data, projection, bbox: [-4.81, 41.49, -4.79, 41.51],
    graph: { stops: [], walk: { network: 'streets' }, streets: walk },
  });
  const size = { width: 400, height: 300, dpr: 2 };
  const view = { cx: lineStart[0], cy: lineStart[1], scale: 0.25, fitScale: 0.25 };

  it('strokes bus lines with the map transform (dpr x scale), not a leftover pixel transform', () => {
    const renderer = make();
    renderer.setStreetTimes(Float64Array.from([0, 5]), 45);
    renderer.draw(view, size, [], { contourLabel: () => '' });
    const line = strokes.find(({ path }) => path.ops[0]?.[1] === lineStart[0] && path.ops[0]?.[2] === lineStart[1]);
    expect(line).toBeDefined();
    expect(line.a).toBeCloseTo(size.dpr * view.scale, 9);
  });

  it('repaints the street layer only when it is stale: panning inside the margin reuses it', () => {
    const renderer = make();
    renderer.setStreetTimes(Float64Array.from([0, 5]), 45);
    renderer.draw(view, size, [], { contourLabel: () => '' });
    const streetStrokes = () => strokes.filter(({ path }) => path.ops.length && path !== undefined).length;
    const first = streetStrokes();
    strokes.length = 0;
    renderer.draw({ ...view, cx: view.cx + 20 / view.scale }, size, [], { contourLabel: () => '' }); // 20 px pan
    const panned = streetStrokes();
    strokes.length = 0;
    renderer.draw({ ...view, scale: 0.3 }, size, [], { contourLabel: () => '' }); // zoom: repaint
    expect(panned).toBeLessThan(first);
    expect(streetStrokes()).toBeGreaterThanOrEqual(first - 1);
  });
});
