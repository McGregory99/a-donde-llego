// Pedestrian street graph (walk.json) in typed arrays, plus snapping and bounded shortest paths.
// Mirrors pipeline/adl/walkgraph.py (layout, nearest) and StreetGraph.reach: the golden cross-check in
// web/tests/core keeps both in sync. Integers only on the wire; metres are whole numbers.
import { distanceM } from './geo.js';

const CELL_DEG = 0.001; // snapping grid, about 111 m (same as the Python side)
const METRES_PER_CELL = 111_320 * CELL_DEG;

function undelta(values) {
  const out = new Int32Array(values.length);
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) out[i] = sum += values[i];
  return out;
}

/** Decodes a walk.json asset into typed arrays: nodes, CSR adjacency, edge classes/shapes and stop snaps. */
export function decodeWalk(asset) {
  const { scale, n } = asset;
  const latI = undelta(asset.lat);
  const lonI = undelta(asset.lon);
  const lat = Float64Array.from(latI, (v) => v / scale);
  const lon = Float64Array.from(lonI, (v) => v / scale);
  const edges = asset.m.length;
  const edgeA = new Int32Array(edges);
  const edgeB = new Int32Array(edges);
  const shapeStart = new Int32Array(edges + 1);
  const shapeLat = new Float64Array(asset.glat.length);
  const shapeLon = new Float64Array(asset.glon.length);
  const degree = new Int32Array(n + 1);
  let edge = 0;
  let point = 0;
  for (let a = 0; a < n; a += 1) {
    for (let k = 0; k < asset.deg[a]; k += 1, edge += 1) {
      const b = a + asset.to[edge];
      edgeA[edge] = a;
      edgeB[edge] = b;
      degree[a] += 1;
      degree[b] += 1;
      shapeStart[edge] = point;
      let la = latI[a];
      let lo = lonI[a];
      for (let s = 0; s < asset.geo[edge]; s += 1, point += 1) {
        la += asset.glat[point];
        lo += asset.glon[point];
        shapeLat[point] = la / scale;
        shapeLon[point] = lo / scale;
      }
    }
  }
  shapeStart[edges] = point;

  const adjStart = new Int32Array(n + 1);
  for (let i = 0; i < n; i += 1) adjStart[i + 1] = adjStart[i] + degree[i];
  const fill = adjStart.slice(0, n);
  const adjTo = new Int32Array(adjStart[n]);
  const adjM = new Int32Array(adjStart[n]);
  const adjEdge = new Int32Array(adjStart[n]);
  for (let e = 0; e < edges; e += 1) {
    const a = edgeA[e];
    const b = edgeB[e];
    for (const [from, to] of [[a, b], [b, a]]) {
      const slot = fill[from]++;
      adjTo[slot] = to;
      adjM[slot] = asset.m[e];
      adjEdge[slot] = e;
    }
  }

  const stopNode = Int32Array.from(asset.stops?.node ?? []);
  const stopSnap = Float64Array.from(asset.stops?.snap_m ?? []);
  const stopsAt = new Map(); // street node -> stops snapped to it
  stopNode.forEach((node, stop) => {
    if (node < 0) return;
    const list = stopsAt.get(node);
    if (list) list.push(stop);
    else stopsAt.set(node, [stop]);
  });
  return {
    n, scale, lat, lon, edges, edgeA, edgeB, edgeM: Int32Array.from(asset.m), edgeCls: Uint8Array.from(asset.cls),
    shapeStart, shapeLat, shapeLon, adjStart, adjTo, adjM, adjEdge, stopNode, stopSnap, stopsAt,
    index: null, scratch: null,
  };
}

/** Intermediate shape points [[lat, lon], ...] of an edge, from its lower node to its higher one. */
export function edgeShape(walk, edge) {
  const out = [];
  for (let k = walk.shapeStart[edge]; k < walk.shapeStart[edge + 1]; k += 1) out.push([walk.shapeLat[k], walk.shapeLon[k]]);
  return out;
}

const cellOf = (lat, lon) => [Math.floor(lat / CELL_DEG), Math.floor((lon * Math.cos((lat * Math.PI) / 180)) / CELL_DEG)];

function buildIndex(walk) {
  const cells = new Map();
  for (let i = 0; i < walk.n; i += 1) {
    const [ci, cj] = cellOf(walk.lat[i], walk.lon[i]);
    const key = ci * 4_000_003 + cj;
    const list = cells.get(key);
    if (list) list.push(i);
    else cells.set(key, [i]);
  }
  return cells;
}

/** Closest street node within `maxM` straight-line metres of `point` ([lat, lon]): { node, metres } or null. */
export function nearestNode(walk, point, maxM) {
  if (!walk.n) return null;
  walk.index ??= buildIndex(walk);
  const [ci, cj] = cellOf(point[0], point[1]);
  let best = null;
  const rings = Math.ceil(maxM / METRES_PER_CELL) + 2;
  for (let ring = 0; ring < rings; ring += 1) {
    for (let i = ci - ring; i <= ci + ring; i += 1) {
      for (let j = cj - ring; j <= cj + ring; j += 1) {
        if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== ring) continue;
        for (const node of walk.index.get(i * 4_000_003 + j) ?? []) {
          const d = distanceM(point, [walk.lat[node], walk.lon[node]]);
          if (d <= maxM && (!best || d < best.metres || (d === best.metres && node < best.node))) best = { node, metres: d };
        }
      }
    }
    if (best && best.metres <= ring * METRES_PER_CELL) break;
  }
  return best;
}

// Scratch buffers per graph: Dijkstra runs thousands of times per scene, so nothing is allocated per node.
function scratchOf(walk) {
  if (!walk.scratch) {
    walk.scratch = {
      dist: new Float64Array(walk.n).fill(Infinity),
      parent: new Int32Array(walk.n).fill(-1),
      costs: new Float64Array(1024),
      ids: new Int32Array(1024),
    };
  }
  return walk.scratch;
}

/**
 * Shortest street metres from `source` to every node within `limitM` (inclusive).
 * Returns { nodes, dist, parent } as aligned typed arrays (parent: predecessor node, -1 at the source).
 */
export function reach(walk, source, limitM) {
  const s = scratchOf(walk);
  const { dist, parent } = s;
  let { costs, ids } = s;
  let size = 0;
  const touched = [source];
  dist[source] = 0;
  parent[source] = -1;

  const push = (cost, id) => {
    if (size === costs.length) {
      const grownCosts = new Float64Array(size * 2);
      const grownIds = new Int32Array(size * 2);
      grownCosts.set(costs);
      grownIds.set(ids);
      costs = s.costs = grownCosts;
      ids = s.ids = grownIds;
    }
    let i = size++;
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (costs[up] <= cost) break;
      costs[i] = costs[up];
      ids[i] = ids[up];
      i = up;
    }
    costs[i] = cost;
    ids[i] = id;
  };

  push(0, source);
  while (size) {
    const d = costs[0];
    const node = ids[0];
    size -= 1;
    if (size) {
      const cost = costs[size];
      const id = ids[size];
      let i = 0;
      for (;;) {
        let child = 2 * i + 1;
        if (child >= size) break;
        if (child + 1 < size && costs[child + 1] < costs[child]) child += 1;
        if (costs[child] >= cost) break;
        costs[i] = costs[child];
        ids[i] = ids[child];
        i = child;
      }
      costs[i] = cost;
      ids[i] = id;
    }
    if (d > dist[node]) continue;
    for (let k = walk.adjStart[node]; k < walk.adjStart[node + 1]; k += 1) {
      const next = walk.adjTo[k];
      const nd = d + walk.adjM[k];
      if (nd <= limitM && nd < dist[next]) {
        if (dist[next] === Infinity) touched.push(next);
        dist[next] = nd;
        parent[next] = node;
        push(nd, next);
      }
    }
  }

  const nodes = Int32Array.from(touched);
  const outDist = new Float64Array(nodes.length);
  const outParent = new Int32Array(nodes.length);
  nodes.forEach((node, k) => {
    outDist[k] = dist[node];
    outParent[k] = parent[node];
    dist[node] = Infinity;
    parent[node] = -1;
  });
  return { nodes, dist: outDist, parent: outParent };
}

/** Nodes from the search source to `target` (a node reached by `found`), or null when it was not reached. */
export function routeNodes(found, target) {
  const slot = new Map();
  found.nodes.forEach((node, k) => slot.set(node, k));
  if (!slot.has(target)) return null;
  const route = [];
  for (let node = target; node !== -1; node = found.parent[slot.get(node)]) route.push(node);
  return route.reverse();
}

/** Polyline [[lat, lon], ...] along a node route, following each edge's shape points. */
export function pathAlong(walk, route) {
  const path = [];
  route.forEach((node, k) => {
    if (k) {
      const prev = route[k - 1];
      let edge = -1;
      for (let s = walk.adjStart[prev]; s < walk.adjStart[prev + 1]; s += 1) {
        if (walk.adjTo[s] === node && (edge === -1 || walk.adjM[s] < walk.edgeM[edge])) edge = walk.adjEdge[s];
      }
      const shape = edgeShape(walk, edge);
      path.push(...(prev < node ? shape : shape.reverse()));
    }
    path.push([walk.lat[node], walk.lon[node]]);
  });
  return path;
}
