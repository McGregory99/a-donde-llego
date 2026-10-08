// Stop markers: when they are drawn (zoom threshold) and which stop a pointer hits.
import { describe, expect, it } from 'vitest';
import { STOP_HIT_RADIUS, STOP_ZOOM_SCALE, nearestStop, stopsVisible } from '../../src/ui/stops.js';

describe('stopsVisible', () => {
  it('hides stops until the view is zoomed past the threshold', () => {
    expect(STOP_ZOOM_SCALE).toBeGreaterThan(1);
    expect(stopsVisible({ scale: 1, fitScale: 1 })).toBe(false);
    expect(stopsVisible({ scale: STOP_ZOOM_SCALE, fitScale: 1 })).toBe(false);
    expect(stopsVisible({ scale: STOP_ZOOM_SCALE + 0.01, fitScale: 1 })).toBe(true);
    expect(stopsVisible({ scale: 0.4, fitScale: 0.2 })).toBe(true);
  });
});

describe('nearestStop', () => {
  const screens = [[100, 100], [140, 100]];

  it('returns the closest stop within the hit radius, else null', () => {
    expect(nearestStop([103, 100], screens, 'mouse')).toBe(0);
    expect(nearestStop([130, 100], screens, 'mouse')).toBe(1);
    expect(nearestStop([100, 100 + STOP_HIT_RADIUS.mouse + 1], screens, 'mouse')).toBeNull();
    expect(nearestStop([0, 0], [], 'mouse')).toBeNull();
  });

  it('is more forgiving for touch', () => {
    const far = [100, 100 + STOP_HIT_RADIUS.mouse + 4];
    expect(nearestStop(far, screens, 'mouse')).toBeNull();
    expect(nearestStop(far, screens, 'touch')).toBe(0);
  });
});
