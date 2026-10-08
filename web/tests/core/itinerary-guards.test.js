// PR9 review: the predecessor chain must never be trusted blindly when looking up an edge.
import { describe, expect, it } from 'vitest';
import { edgeMinutes } from '../../src/core/itinerary.js';

describe('edgeMinutes', () => {
  it('returns the minutes of the edge towards the target', () => {
    expect(edgeMinutes([[3, 2.5], [7, 4]], 7, 'ride hop 1 -> 7')).toBe(4);
  });

  it('throws an error naming the missing edge', () => {
    expect(() => edgeMinutes([[3, 2.5]], 9, 'ride hop 1 -> 9')).toThrow(/ride hop 1 -> 9/);
  });

  it('throws for an absent edge list instead of a TypeError', () => {
    expect(() => edgeMinutes(undefined, 9, 'walk 2 -> 9')).toThrow(/walk 2 -> 9/);
  });
});
