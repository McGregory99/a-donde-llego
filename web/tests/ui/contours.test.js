// Where an isochrone gets its "N min" label: northmost visible spot on land, clear of markers and other labels.
import { describe, expect, it } from 'vitest';
import { labelSpot } from '../../src/ui/contours.js';

const size = { width: 800, height: 600 };
// Screen position equals the world position here.
const project = ([x, y]) => [x, y];
const segment = (x, y) => [[x, y], [x + 1, y]];

describe('labelSpot', () => {
  it('picks the visible segment with the smallest screen y (northmost)', () => {
    const spot = labelSpot([segment(300, 300), segment(400, 100), segment(500, 200)], { project, size });
    expect(spot).toEqual({ world: [400.5, 100], at: [400.5, 100] });
  });

  it('skips segments near the edges of the canvas', () => {
    const spot = labelSpot([segment(10, 100), segment(790, 100), segment(400, 5), segment(300, 300)], { project, size });
    expect(spot.at).toEqual([300.5, 300]);
  });

  it('skips segments just above a marker or an earlier label', () => {
    const avoid = [[400, 150]];
    const spot = labelSpot([segment(400, 100), segment(600, 300)], { project, size, avoid });
    expect(spot.at).toEqual([600.5, 300]);
  });

  it('skips spots the land test rejects', () => {
    const spot = labelSpot([segment(400, 100), segment(300, 300)], { project, size, isOnLand: ([x]) => x < 350 });
    expect(spot.at).toEqual([300.5, 300]);
  });

  it('returns null when nothing qualifies', () => {
    expect(labelSpot([], { project, size })).toBeNull();
    expect(labelSpot([segment(5, 5)], { project, size })).toBeNull();
  });
});
