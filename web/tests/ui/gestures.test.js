// Pointer gestures: click vs pan, marker drag, pinch zoom, hit radii (mouse vs touch).
import { describe, expect, it } from 'vitest';
import { CLICK_SLOP, HIT_RADIUS, createGestures, markerAt } from '../../src/ui/gestures.js';

const markers = [{ key: 'origin', screen: [100, 100] }, { key: 'destination', screen: [300, 100] }];

describe('markerAt', () => {
  it('finds the marker within the hit radius and prefers the first listed', () => {
    expect(markerAt([110, 100], markers, 'mouse')).toBe('origin');
    expect(markerAt([100 + HIT_RADIUS.mouse + 1, 100], markers, 'mouse')).toBeNull();
    expect(markerAt([200, 100], [{ key: 'a', screen: [195, 100] }, { key: 'b', screen: [205, 100] }], 'mouse')).toBe('a');
  });

  it('is more forgiving for touch', () => {
    const near = [100 + HIT_RADIUS.mouse + 5, 100];
    expect(markerAt(near, markers, 'mouse')).toBeNull();
    expect(markerAt(near, markers, 'touch')).toBe('origin');
  });
});

describe('single pointer', () => {
  it('a tap without movement is a click at the release position', () => {
    const g = createGestures();
    g.down(1, [50, 50], 'mouse', markers);
    expect(g.up(1, [52, 51])).toEqual({ type: 'click', screen: [52, 51] });
  });

  it('movement under the slop still counts as a click', () => {
    const g = createGestures();
    g.down(1, [50, 50], 'mouse', markers);
    expect(g.move(1, [50 + CLICK_SLOP.mouse - 1, 50])).toBeNull();
    expect(g.up(1, [50, 50]).type).toBe('click');
  });

  it('a drag beyond the slop pans by the delta since the last move and never clicks', () => {
    const g = createGestures();
    g.down(1, [50, 50], 'mouse', markers);
    expect(g.move(1, [70, 50])).toEqual({ type: 'pan', dx: 20, dy: 0 });
    expect(g.move(1, [75, 60])).toEqual({ type: 'pan', dx: 5, dy: 10 });
    expect(g.up(1, [75, 60])).toBeNull();
  });

  it('touch tolerates a larger tap wobble', () => {
    const g = createGestures();
    g.down(1, [50, 50], 'touch', markers);
    expect(g.move(1, [50 + CLICK_SLOP.mouse + 2, 50])).toBeNull();
    expect(g.up(1, [50, 50]).type).toBe('click');
  });

  it('grabbing a marker drags it and reports the end', () => {
    const g = createGestures();
    g.down(1, [102, 100], 'mouse', markers);
    expect(g.move(1, [140, 120])).toEqual({ type: 'drag', key: 'origin', screen: [140, 120] });
    expect(g.up(1, [140, 120])).toEqual({ type: 'drag-end', key: 'origin' });
  });

  it('a cancelled gesture produces nothing', () => {
    const g = createGestures();
    g.down(1, [50, 50], 'mouse', markers);
    g.move(1, [90, 50]);
    g.cancel(1);
    expect(g.up(1, [90, 50])).toBeNull();
  });

  it('moves with no active pointer are ignored', () => {
    expect(createGestures().move(9, [1, 1])).toBeNull();
  });
});

describe('two pointers', () => {
  it('pinch reports the ratio of finger distances around their midpoint', () => {
    const g = createGestures();
    g.down(1, [100, 100], 'touch', []);
    g.down(2, [200, 100], 'touch', []);
    expect(g.move(2, [300, 100])).toEqual({ type: 'pinch', factor: 2, center: [200, 100] });
    expect(g.move(2, [200, 100])).toEqual({ type: 'pinch', factor: 0.5, center: [150, 100] });
  });

  it('lifting the fingers ends the pinch without a click', () => {
    const g = createGestures();
    g.down(1, [100, 100], 'touch', []);
    g.down(2, [200, 100], 'touch', []);
    expect(g.up(2, [200, 100])).toBeNull();
    expect(g.up(1, [100, 100])).toBeNull();
  });
});

describe('interrupted marker drags', () => {
  it('a second finger during a marker drag ends the drag so the app can restore full quality', () => {
    const g = createGestures();
    g.down(1, [102, 100], 'touch', markers);
    g.move(1, [140, 120]);
    expect(g.down(2, [300, 300], 'touch', markers)).toEqual({ type: 'drag-end', key: 'origin' });
    expect(g.move(2, [320, 300])).toEqual({ type: 'pinch', factor: expect.any(Number), center: expect.any(Array) });
  });

  it('a second finger during a pan or pinch interrupts nothing', () => {
    const g = createGestures();
    expect(g.down(1, [50, 50], 'touch', markers)).toBeNull();
    expect(g.down(2, [80, 50], 'touch', markers)).toBeNull();
  });

  it('cancelling a marker drag reports its end; cancelling a pan reports nothing', () => {
    const g = createGestures();
    g.down(1, [102, 100], 'mouse', markers);
    g.move(1, [140, 120]);
    expect(g.cancel(1)).toEqual({ type: 'drag-end', key: 'origin' });
    g.down(2, [50, 50], 'mouse', markers);
    g.move(2, [90, 50]);
    expect(g.cancel(2)).toBeNull();
  });
});
