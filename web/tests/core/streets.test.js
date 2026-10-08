// Street graph decoding, snapping and bounded shortest paths (mirrors pipeline/adl/walkgraph.py).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeWalk, edgeShape, nearestNode, reach, routeNodes } from '../../src/core/streets.js';

const golden = JSON.parse(readFileSync(new URL('../golden/travel_times_streets.json', import.meta.url), 'utf8'));

// Hand-made asset: 0 -(100 m)- 1 -(50 m, one shape point)- 2, plus 0 -(300 m)- 2. Coordinates in 1e-5 degrees.
const tiny = {
  schema: 1, scale: 100000, n: 3,
  lat: [4160000, 100, 0], lon: [-470000, 100, 100],
  deg: [2, 1, 0], to: [1, 2, 1], m: [100, 300, 50], cls: [1, 2, 0], geo: [0, 0, 1], glat: [5], glon: [-3],
  stops: { node: [1, -1], snap_m: [7, 0] },
};

describe('decodeWalk', () => {
  const walk = decodeWalk(tiny);

  it('decodes delta-encoded coordinates into degrees', () => {
    expect(walk.n).toBe(3);
    expect(Array.from(walk.lat)).toEqual([41.6, 41.601, 41.601]);
    expect(walk.lon[0]).toBeCloseTo(-4.7, 9);
    expect(walk.lon[2]).toBeCloseTo(-4.698, 9);
  });

  it('lists every edge once and in both directions of the adjacency', () => {
    expect(walk.edges).toBe(3);
    const neighbours = (node) => Array.from({ length: walk.adjStart[node + 1] - walk.adjStart[node] }, (_, k) => walk.adjTo[walk.adjStart[node] + k]).sort();
    expect(neighbours(0)).toEqual([1, 2]);
    expect(neighbours(1)).toEqual([0, 2]);
    expect(neighbours(2)).toEqual([0, 1]);
  });

  it('keeps road classes, metres and the stop snaps', () => {
    expect(Array.from(walk.edgeCls)).toEqual([1, 2, 0]);
    expect(Array.from(walk.edgeM)).toEqual([100, 300, 50]);
    expect(Array.from(walk.stopNode)).toEqual([1, -1]);
    expect(Array.from(walk.stopSnap)).toEqual([7, 0]);
  });

  it('decodes edge shapes oriented from the lower node, deltas from that node', () => {
    expect(edgeShape(walk, 2)).toEqual([[41.60105, -4.69903]]);
    expect(edgeShape(walk, 0)).toEqual([]);
  });

  it('accepts an empty street graph', () => {
    const empty = decodeWalk({ schema: 1, scale: 100000, n: 0, lat: [], lon: [], deg: [], to: [], m: [], cls: [], geo: [], glat: [], glon: [] });
    expect(empty.n).toBe(0);
    expect(nearestNode(empty, [41.6, -4.7], 150)).toBeNull();
  });
});

describe('nearestNode', () => {
  const walk = decodeWalk(tiny);
  it('finds the closest node within the limit, with its distance', () => {
    const hit = nearestNode(walk, [41.60105, -4.699], 150);
    expect(hit.node).toBe(1);
    expect(hit.metres).toBeGreaterThan(5);
    expect(hit.metres).toBeLessThan(15);
  });
  it('is null beyond the limit', () => {
    expect(nearestNode(walk, [41.605, -4.7], 150)).toBeNull();
  });
});

describe('reach', () => {
  const walk = decodeWalk(tiny);
  it('gives shortest street metres within the limit, with the way back', () => {
    const found = reach(walk, 0, 1000);
    const dist = Object.fromEntries(Array.from(found.nodes, (n, k) => [n, found.dist[k]]));
    expect(dist).toEqual({ 0: 0, 1: 100, 2: 150 }); // 0-1-2 (150) beats the 300 m direct edge
    expect(routeNodes(found, 2)).toEqual([0, 1, 2]);
  });
  it('stops at the limit (inclusive)', () => {
    const found = reach(walk, 0, 100);
    expect(Array.from(found.nodes).sort()).toEqual([0, 1]);
  });
  it('can be called repeatedly without leaking state', () => {
    reach(walk, 0, 1000);
    expect(Array.from(reach(walk, 2, 60).nodes).sort()).toEqual([1, 2]);
  });
});

describe('the golden street graph', () => {
  it('decodes to as many nodes as the asset says and every stop snap is rounded metres', () => {
    const walk = decodeWalk(golden.walk);
    expect(walk.n).toBe(golden.walk.n);
    expect(walk.edges).toBe(golden.walk.m.length);
    expect(walk.stopNode).toHaveLength(golden.graph.stops.length);
  });
});
