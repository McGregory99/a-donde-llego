// @vitest-environment jsdom
// Map widget wiring: interrupted drags must still end, and a map without a sized canvas must not throw.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMap } from '../../src/ui/map.js';
import { createProjection } from '../../src/ui/view.js';

const projection = createProjection([41.65, -4.72]);
const origin = [41.65, -4.72];

function setup({ width, height, stops = [], markers: extra = [] }) {
  const canvas = document.createElement('canvas');
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width, height });
  canvas.setPointerCapture = vi.fn();
  document.body.replaceChildren(canvas);
  const handlers = { onClick: vi.fn(), onDrag: vi.fn(), onDragEnd: vi.fn(), onDoubleClick: vi.fn(), onMarkerClick: vi.fn(), onStopFocus: vi.fn() };
  const renderer = { bounds: [-1000, -1000, 1000, 1000], draw: vi.fn() };
  const markers = [{ key: 'origin', point: origin, color: '#000', label: null, draggable: true }, ...extra];
  const map = createMap({ canvas, renderer, projection, getMarkers: () => markers, contourLabel: String, handlers, stops });
  const fire = (type, init = {}) => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, ...init });
    Object.assign(event, { pointerId: init.pointerId ?? 1, pointerType: init.pointerType ?? 'touch' });
    canvas.dispatchEvent(event);
  };
  return { map, handlers, fire, canvas };
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} });
  vi.stubGlobal('requestAnimationFrame', (callback) => callback());
});
afterEach(() => vi.unstubAllGlobals());

describe('createMap interrupted drags', () => {
  const grab = (fire) => {
    fire('pointerdown', { clientX: 200, clientY: 150, pointerId: 1 });
    fire('pointermove', { clientX: 230, clientY: 160, pointerId: 1 });
  };

  it('pointercancel during a marker drag ends the drag once', () => {
    const { fire, handlers } = setup({ width: 400, height: 300 });
    grab(fire);
    expect(handlers.onDrag).toHaveBeenCalledTimes(1);
    fire('pointercancel', { pointerId: 1 });
    expect(handlers.onDragEnd).toHaveBeenCalledTimes(1);
    expect(handlers.onDragEnd).toHaveBeenCalledWith('origin');
  });

  it('a second finger during the drag ends it and later releases do not end it again', () => {
    const { fire, handlers } = setup({ width: 400, height: 300 });
    grab(fire);
    fire('pointerdown', { clientX: 20, clientY: 20, pointerId: 2 });
    expect(handlers.onDragEnd).toHaveBeenCalledTimes(1);
    fire('pointerup', { clientX: 20, clientY: 20, pointerId: 2 });
    fire('pointerup', { clientX: 230, clientY: 160, pointerId: 1 });
    expect(handlers.onDragEnd).toHaveBeenCalledTimes(1);
  });
});

describe('createMap before the canvas has a size', () => {
  it('ignores pointer, wheel and double-click input instead of throwing', () => {
    const { fire, handlers } = setup({ width: 0, height: 0 });
    // jsdom reports errors thrown inside listeners on window instead of rethrowing them.
    const errors = [];
    window.addEventListener('error', (event) => {
      event.preventDefault();
      errors.push(event.error);
    });
    fire('pointerdown', { clientX: 5, clientY: 5 });
    fire('pointermove', { clientX: 9, clientY: 9 });
    fire('pointerup', { clientX: 9, clientY: 9 });
    fire('wheel', { deltaY: 10 });
    fire('dblclick', { clientX: 5, clientY: 5 });
    expect(errors).toEqual([]);
    for (const handler of Object.values(handlers)) expect(handler).not.toHaveBeenCalled();
  });

  it('keeps the programmatic controls safe', () => {
    const { map } = setup({ width: 0, height: 0 });
    expect(() => {
      map.zoomIn();
      map.zoomOut();
      map.recenter();
      map.reveal(origin);
    }).not.toThrow();
  });
});

describe('createMap destination marker and stops', () => {
  // View fits [-1000, 1000] m in 400x300: scale ~0.138 px/m, so 200 m east of the centre is 28 px away until zoomed in.
  const east = (metres) => projection.toLatLon([metres, 0]);
  const stops = [{ point: east(200), name: 'Parada Este' }];
  const destination = { key: 'destination', point: east(-400), color: '#111', label: null, draggable: false };
  const zoomed = (extra) => {
    const ctx = setup({ width: 400, height: 300, stops, markers: [destination], ...extra });
    ctx.map.zoomBy(2);
    return ctx;
  };
  // After zoomBy(2) around the centre: scale 0.276 -> stop at x = 200 + 55 = 255, destination at x = 200 - 110 = 90.

  it('clicking the destination marker reports it instead of moving the destination', () => {
    const { fire, handlers } = zoomed();
    fire('pointerdown', { clientX: 90, clientY: 150, pointerType: 'mouse' });
    fire('pointerup', { clientX: 90, clientY: 150, pointerType: 'mouse' });
    expect(handlers.onMarkerClick).toHaveBeenCalledWith('destination');
    expect(handlers.onClick).not.toHaveBeenCalled();
  });

  it('hovering a visible stop focuses it; leaving clears it', () => {
    const { fire, handlers } = zoomed();
    fire('pointermove', { clientX: 255, clientY: 150, pointerType: 'mouse' });
    expect(handlers.onStopFocus).toHaveBeenLastCalledWith(0, expect.any(Array));
    fire('pointermove', { clientX: 300, clientY: 250, pointerType: 'mouse' });
    expect(handlers.onStopFocus).toHaveBeenLastCalledWith(null, null);
  });

  it('does not focus stops while zoomed out', () => {
    const { fire, handlers } = setup({ width: 400, height: 300, stops, markers: [destination] });
    fire('pointermove', { clientX: 228, clientY: 150, pointerType: 'mouse' });
    expect(handlers.onStopFocus).not.toHaveBeenCalledWith(0, expect.anything());
  });

  it('tapping a stop shows its name and still sets the destination there', () => {
    const { fire, handlers } = zoomed();
    fire('pointerdown', { clientX: 255, clientY: 150 });
    fire('pointerup', { clientX: 255, clientY: 150 });
    expect(handlers.onStopFocus).toHaveBeenCalledWith(0, expect.any(Array));
    expect(handlers.onClick).toHaveBeenCalledTimes(1);
  });

  it('the touch pointerleave fired after a tap keeps the stop name visible', () => {
    const { fire, handlers } = zoomed();
    fire('pointerdown', { clientX: 255, clientY: 150 });
    fire('pointerup', { clientX: 255, clientY: 150 });
    fire('pointerleave', { clientX: 255, clientY: 150 });
    expect(handlers.onStopFocus).toHaveBeenLastCalledWith(0, expect.any(Array));
  });

  it('a mouse leaving the map hides the tooltip', () => {
    const { fire, handlers } = zoomed();
    fire('pointermove', { clientX: 255, clientY: 150, pointerType: 'mouse' });
    fire('pointerleave', { clientX: 255, clientY: 150, pointerType: 'mouse' });
    expect(handlers.onStopFocus).toHaveBeenLastCalledWith(null, null);
  });

  it('tapping empty map hides the tooltip', () => {
    const { fire, handlers } = zoomed();
    fire('pointerdown', { clientX: 255, clientY: 150 });
    fire('pointerup', { clientX: 255, clientY: 150 });
    fire('pointerdown', { clientX: 330, clientY: 260 });
    fire('pointerup', { clientX: 330, clientY: 260 });
    expect(handlers.onStopFocus).toHaveBeenLastCalledWith(null, null);
  });
});
