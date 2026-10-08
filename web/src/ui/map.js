// Map widget: owns the view (pan/zoom), the pointer gestures and frame scheduling (browser only).
import { createGestures, markerAt } from './gestures.js';
import { nearestStop, stopsVisible } from './stops.js';
import { fitView, panBy, resizeView, toScreen, toWorldPoint, zoomAt } from './view.js';

const WHEEL_STEP = { plain: 0.0018, pinch: 0.01 };
const BUTTON_ZOOM = 1.4;

/**
 * `getMarkers()` -> [{key, point: [lat, lon], color, label, draggable}]; `stops` -> [{point: [lat, lon]}] (hover/tap targets
 * while zoomed in); `handlers` receive lat/lon points: onClick(point), onDrag(key, point), onDragEnd(key), onDoubleClick(key),
 * onMarkerClick(key) for a click on a non-draggable marker, onStopFocus(index | null, screen | null) for the stop under the pointer.
 */
export function createMap({ canvas, renderer, projection, getMarkers, contourLabel, handlers, stops = [] }) {
  let size = { width: 0, height: 0, dpr: 1 };
  let view = null;
  let queued = false;
  const gestures = createGestures();

  const latLonAt = (screen) => projection.toLatLon(toWorldPoint(view, size, screen));
  const screenOf = (point) => toScreen(view, size, projection.toWorld(point));
  const eventScreen = (event) => {
    const rect = canvas.getBoundingClientRect();
    return [event.clientX - rect.left, event.clientY - rect.top];
  };
  const kindOf = (event) => (event.pointerType === 'mouse' ? 'mouse' : 'touch');
  const draggable = () => getMarkers().filter((m) => m.draggable).map((m) => ({ key: m.key, screen: screenOf(m.point) }));

  // Stops react only while they are drawn; hovering (mouse) and tapping (touch) report the one under the pointer.
  let focusedStop = null;
  const focusStop = (index, screen = null) => {
    if (index === focusedStop) return;
    focusedStop = index;
    handlers.onStopFocus(index, index === null ? null : screen);
  };
  const stopAt = (screen, kind) => {
    if (!stopsVisible(view)) return null;
    const index = nearestStop(screen, stops.map((stop) => screenOf(stop.point)), kind);
    return index === null ? null : { index, screen: screenOf(stops[index].point) };
  };
  const focusAt = (screen, kind) => {
    const hit = stopAt(screen, kind);
    if (hit) focusStop(hit.index, hit.screen);
    else focusStop(null);
  };

  function render() {
    queued = false;
    if (view) renderer.draw(view, size, getMarkers(), { contourLabel });
  }
  const requestRender = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(render);
  };

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const next = { width: rect.width, height: rect.height, dpr: window.devicePixelRatio || 1 };
    canvas.width = Math.round(next.width * next.dpr);
    canvas.height = Math.round(next.height * next.dpr);
    if (!next.width || !next.height) return;
    view = view && size.width ? resizeView(view, size, next) : fitView(renderer.bounds, next, next.width < 720 ? 12 : 40);
    size = next;
    requestRender();
  }

  const endDrag = (action) => {
    if (action?.type === 'drag-end') handlers.onDragEnd(action.key);
  };

  // The view stays null until the canvas has a size; input before that is ignored.
  canvas.addEventListener('pointerdown', (event) => {
    if (!view) return;
    canvas.setPointerCapture(event.pointerId);
    endDrag(gestures.down(event.pointerId, eventScreen(event), kindOf(event), draggable()));
  });

  canvas.addEventListener('pointermove', (event) => {
    if (!view) return;
    const screen = eventScreen(event);
    const action = gestures.move(event.pointerId, screen);
    if (!action) {
      canvas.classList.toggle('over-marker', draggable().some((m) => Math.hypot(m.screen[0] - screen[0], m.screen[1] - screen[1]) < 18));
      if (kindOf(event) === 'mouse') focusAt(screen, 'mouse');
      return;
    }
    focusStop(null);
    if (action.type === 'pan') {
      view = panBy(view, action.dx, action.dy);
      canvas.classList.add('panning');
      requestRender();
    } else if (action.type === 'pinch') {
      view = zoomAt(view, size, action.factor, ...action.center);
      requestRender();
    } else if (action.type === 'drag') {
      handlers.onDrag(action.key, latLonAt(action.screen));
    }
  });

  const finish = (event) => {
    canvas.classList.remove('panning');
    const action = event.type === 'pointercancel' ? gestures.cancel(event.pointerId) : gestures.up(event.pointerId, eventScreen(event));
    if (action?.type === 'click') {
      const kind = kindOf(event);
      const fixed = getMarkers().filter((m) => !m.draggable).map((m) => ({ key: m.key, screen: screenOf(m.point) }));
      const key = markerAt(action.screen, fixed, kind);
      if (key) {
        focusStop(null);
        handlers.onMarkerClick(key);
        return;
      }
      focusAt(action.screen, kind);
      handlers.onClick(latLonAt(action.screen));
    } else endDrag(action);
  };
  canvas.addEventListener('pointerup', finish);
  canvas.addEventListener('pointercancel', finish);
  canvas.addEventListener('pointerleave', () => focusStop(null));

  canvas.addEventListener('dblclick', (event) => {
    if (!view) return;
    const screen = eventScreen(event);
    const hit = getMarkers().find((m) => Math.hypot(...screenOf(m.point).map((v, i) => v - screen[i])) <= 18);
    if (hit) handlers.onDoubleClick(hit.key);
  });

  canvas.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      if (!view) return;
      focusStop(null);
      const [x, y] = eventScreen(event);
      view = zoomAt(view, size, Math.exp(-event.deltaY * (event.ctrlKey ? WHEEL_STEP.pinch : WHEEL_STEP.plain)), x, y);
      requestRender();
    },
    { passive: false },
  );

  new ResizeObserver(resize).observe(canvas);
  resize();

  return {
    requestRender,
    zoomBy(factor) {
      if (!view) return;
      focusStop(null);
      view = zoomAt(view, size, factor, size.width / 2, size.height / 2);
      requestRender();
    },
    zoomIn() {
      this.zoomBy(BUTTON_ZOOM);
    },
    zoomOut() {
      this.zoomBy(1 / BUTTON_ZOOM);
    },
    recenter() {
      if (!view) return;
      view = fitView(renderer.bounds, size, size.width < 720 ? 12 : 40);
      requestRender();
    },
    /** Moves the view to a [lat, lon] when it is off screen. */
    reveal(point) {
      if (!view) return;
      const [x, y] = screenOf(point);
      if (x >= 0 && y >= 0 && x <= size.width && y <= size.height) return;
      const [wx, wy] = projection.toWorld(point);
      view = { ...view, cx: wx, cy: wy };
      requestRender();
    },
  };
}
