// The street walk from every stop depends only on the street graph, never on the origin, so it is computed once.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { stopWalksOf } from '../../src/core/dijkstra.js';
import { decodeWalk, reach } from '../../src/core/streets.js';

const golden = JSON.parse(readFileSync(new URL('../golden/travel_times_streets.json', import.meta.url), 'utf8'));
const graph = { ...golden.graph, streets: decodeWalk(golden.walk) };
const { streets } = graph;
const limit = graph.walk.max_access_m;

describe('stopWalksOf', () => {
  const walks = stopWalksOf(graph, streets);

  it('lists, for every stop, the street nodes within max_access_m with the metres walked (stop snap included)', () => {
    expect(walks.start).toHaveLength(graph.stops.length + 1);
    let checked = 0;
    graph.stops.forEach((_, stop) => {
      const from = streets.stopNode[stop];
      const lo = walks.start[stop];
      const hi = walks.start[stop + 1];
      if (from < 0 || streets.stopSnap[stop] > limit) {
        expect(hi).toBe(lo);
        return;
      }
      const found = reach(streets, from, limit - streets.stopSnap[stop]);
      expect(hi - lo).toBe(found.nodes.length);
      found.nodes.forEach((node, k) => {
        expect(walks.nodes[lo + k]).toBe(node);
        expect(walks.metres[lo + k]).toBeCloseTo(streets.stopSnap[stop] + found.dist[k], 9);
      });
      checked += 1;
    });
    expect(checked).toBeGreaterThan(0);
  });

  it('is computed once per street graph', () => {
    expect(stopWalksOf(graph, streets)).toBe(walks);
  });
});
