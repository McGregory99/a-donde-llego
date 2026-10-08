// Stop markers: the zoom from which they are drawn and pointer hit-testing (pure, no DOM).

/** Stops are drawn once the view is zoomed this many times past the fitted view. */
export const STOP_ZOOM_SCALE = 1.6;
// Fingers aim less precisely than a mouse, so touch gets a larger radius (pixels).
export const STOP_HIT_RADIUS = { mouse: 10, touch: 22 };

/** True when `view` ({scale, fitScale}) is close enough for stop dots to be useful rather than clutter. */
export const stopsVisible = (view) => view.scale > view.fitScale * STOP_ZOOM_SCALE;

/** Index of the stop (screen position list) closest to `screen` within the hit radius, else null. */
export function nearestStop(screen, screens, kind = 'mouse') {
  let best = null;
  let bestDistance = STOP_HIT_RADIUS[kind];
  screens.forEach((point, index) => {
    const distance = Math.hypot(point[0] - screen[0], point[1] - screen[1]);
    if (distance <= bestDistance) {
      best = index;
      bestDistance = distance;
    }
  });
  return best;
}
