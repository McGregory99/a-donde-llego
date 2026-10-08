// Pointer gesture state machine for the map: click vs pan, marker drag, two-finger pinch.
// Pure: it consumes pointer positions and returns actions; the DOM wiring lives in map.js.

// Fingers aim less precisely and wobble during a tap, so touch gets larger tolerances.
export const HIT_RADIUS = { mouse: 18, touch: 30 };
export const CLICK_SLOP = { mouse: 5, touch: 12 };

const hypot = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Key of the first marker ({key, screen}) within the hit radius of `screen`, or null. */
export function markerAt(screen, markers, kind = 'mouse') {
  return markers.find((marker) => hypot(screen, marker.screen) <= HIT_RADIUS[kind])?.key ?? null;
}

export function createGestures() {
  const pointers = new Map(); // id -> screen
  let gesture = null;

  const pair = () => [...pointers.values()];

  return {
    /** Returns a `drag-end` when a second finger interrupts a marker drag, else null. */
    down(id, screen, kind, markers) {
      pointers.set(id, screen);
      if (pointers.size === 2) {
        const interrupted = gesture?.type === 'drag' ? { type: 'drag-end', key: gesture.key } : null;
        const [a, b] = pair();
        gesture = { type: 'pinch', distance: hypot(a, b) };
        return interrupted;
      }
      const key = markerAt(screen, markers, kind);
      gesture = key
        ? { type: 'drag', key }
        : { type: 'pan', start: screen, last: screen, moved: false, slop: CLICK_SLOP[kind] };
      return null;
    },

    move(id, screen) {
      if (!pointers.has(id) || !gesture) return null;
      pointers.set(id, screen);
      if (gesture.type === 'pinch') {
        if (pointers.size < 2) return null;
        const [a, b] = pair();
        const distance = hypot(a, b);
        const factor = distance / gesture.distance;
        gesture.distance = distance;
        return { type: 'pinch', factor, center: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] };
      }
      if (gesture.type === 'drag') return { type: 'drag', key: gesture.key, screen };
      if (!gesture.moved && hypot(screen, gesture.start) < gesture.slop) return null;
      gesture.moved = true;
      const action = { type: 'pan', dx: screen[0] - gesture.last[0], dy: screen[1] - gesture.last[1] };
      gesture.last = screen;
      return action;
    },

    up(id, screen) {
      pointers.delete(id);
      if (!gesture) return null;
      if (gesture.type === 'pinch') {
        if (!pointers.size) gesture = null;
        return null;
      }
      const done = gesture;
      gesture = null;
      if (done.type === 'drag') return { type: 'drag-end', key: done.key };
      return done.moved ? null : { type: 'click', screen };
    },

    /** Returns a `drag-end` when the cancelled pointer was dragging a marker, else null. */
    cancel(id) {
      pointers.delete(id);
      const dragging = gesture?.type === 'drag' ? { type: 'drag-end', key: gesture.key } : null;
      if (!pointers.size) gesture = null;
      return dragging;
    },
  };
}
