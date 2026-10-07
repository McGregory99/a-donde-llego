// Projection and pan/zoom of the canvas map.
import { describe, expect, it } from 'vitest';
import { boundsOf, createProjection, fitView, panBy, resizeView, toScreen, toWorldPoint, zoomAt } from '../../src/ui/view.js';

const size = { width: 800, height: 600 };

describe('createProjection', () => {
  const proj = createProjection([41.65, -4.72]);

  it('puts the reference point at the origin and round-trips', () => {
    expect(proj.toWorld([41.65, -4.72])).toEqual([0, 0]);
    const [lat, lon] = proj.toLatLon(proj.toWorld([41.7, -4.6]));
    expect(lat).toBeCloseTo(41.7, 9);
    expect(lon).toBeCloseTo(-4.6, 9);
  });

  it('has north as +y and east as +x, with ~111 km per degree of latitude', () => {
    const [x, y] = proj.toWorld([42.65, -4.72]);
    expect(x).toBe(0);
    expect(y).toBeGreaterThan(111_000);
    expect(y).toBeLessThan(111_500);
    expect(proj.toWorld([41.65, -4.71])[0]).toBeGreaterThan(0);
  });

  it('shrinks longitude with the cosine of the latitude', () => {
    const [x] = proj.toWorld([41.65, -3.72]);
    expect(x).toBeCloseTo(111_320 * Math.cos((41.65 * Math.PI) / 180), 0);
  });
});

describe('fitView and screen mapping', () => {
  const bounds = [-1000, -500, 1000, 500];

  it('centres the bounds and fits them with padding', () => {
    const view = fitView(bounds, size, 40);
    expect([view.cx, view.cy]).toEqual([0, 0]);
    expect(view.scale).toBe((800 - 80) / 2000);
    expect(view.fitScale).toBe(view.scale);
  });

  it('maps world to screen (y flipped) and back', () => {
    const view = fitView(bounds, size, 40);
    expect(toScreen(view, size, [0, 0])).toEqual([400, 300]);
    const [sx, sy] = toScreen(view, size, [100, 100]);
    expect(sx).toBeGreaterThan(400);
    expect(sy).toBeLessThan(300);
    const back = toWorldPoint(view, size, [sx, sy]);
    expect(back[0]).toBeCloseTo(100, 9);
    expect(back[1]).toBeCloseTo(100, 9);
  });
});

describe('zoomAt', () => {
  const view = fitView([-1000, -500, 1000, 500], size, 40);

  it('keeps the world point under the cursor fixed', () => {
    const cursor = [650, 120];
    const before = toWorldPoint(view, size, cursor);
    const zoomed = zoomAt(view, size, 2, ...cursor);
    expect(zoomed.scale).toBeCloseTo(view.scale * 2, 9);
    const after = toWorldPoint(zoomed, size, cursor);
    expect(after[0]).toBeCloseTo(before[0], 6);
    expect(after[1]).toBeCloseTo(before[1], 6);
  });

  it('clamps between half the fit scale and 14 times it', () => {
    expect(zoomAt(view, size, 1000, 400, 300).scale).toBeCloseTo(view.fitScale * 14, 9);
    expect(zoomAt(view, size, 0.0001, 400, 300).scale).toBeCloseTo(view.fitScale * 0.5, 9);
  });

  it('does not mutate the previous view', () => {
    const copy = { ...view };
    zoomAt(view, size, 2, 10, 10);
    expect(view).toEqual(copy);
  });
});

describe('panBy and resizeView', () => {
  const view = fitView([-1000, -500, 1000, 500], size, 40);

  it('dragging right/down moves the world left/up on screen', () => {
    const panned = panBy(view, 50, 30);
    const [sx, sy] = toScreen(panned, size, [0, 0]);
    expect(sx).toBeCloseTo(450, 9);
    expect(sy).toBeCloseTo(330, 9);
  });

  it('keeps what is centred centred when the canvas is resized', () => {
    const resized = resizeView(view, size, { width: 400, height: 300 });
    expect(resized.scale).toBeCloseTo(view.scale / 2, 9);
    expect(resized.fitScale).toBeCloseTo(view.fitScale / 2, 9);
    expect([resized.cx, resized.cy]).toEqual([view.cx, view.cy]);
  });
});

describe('boundsOf', () => {
  it('is the bounding box of the points grown by the margin', () => {
    expect(boundsOf([[0, 10], [100, -20], [50, 5]], 10)).toEqual([-10, -30, 110, 20]);
  });

  it('is null for no points, so callers can fall back to another extent', () => {
    expect(boundsOf([], 10)).toBeNull();
  });
});
