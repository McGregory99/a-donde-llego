// @vitest-environment jsdom
// Map widget wiring: interrupted drags must still end, and a map without a sized canvas must not throw.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMap } from '../../src/ui/map.js';
import { createProjection } from '../../src/ui/view.js';

const projection = createProjection([41.65, -4.72]);
const origin = [41.65, -4.72];

function setup({ width, height }) {
  const canvas = document.createElement('canvas');
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width, height });
  canvas.setPointerCapture = vi.fn();
  document.body.replaceChildren(canvas);
  const handlers = { onClick: vi.fn(), onDrag: vi.fn(), onDragEnd: vi.fn(), onDoubleClick: vi.fn() };
  const renderer = { bounds: [-1000, -1000, 1000, 1000], draw: vi.fn() };
  const markers = [{ key: 'origin', point: origin, color: '#000', label: null, draggable: true }];
  const map = createMap({ canvas, renderer, projection, getMarkers: () => markers, contourLabel: String, handlers });
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
