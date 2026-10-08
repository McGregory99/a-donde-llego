// Travel-time search over the exported stop graph. Mirrors pipeline/adl/graph.py
// (travel_times): the golden cross-check in web/tests/core keeps both in sync.
//
// Nodes: S(stop) walked-to stop where boarding is possible, B(stop, line) boarded
// with nothing ridden yet, R(stop, line) after at least one ride hop. Only R nodes
// can egress or transfer, so a stop is never a walking shortcut and every line
// change pays the transfer penalty.
import { distanceM, walkMinutes } from './geo.js';
import { MinHeap } from './heap.js';

const prepared = new WeakMap();

function append(map, key, value) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/** Per-graph lookup tables for one set of enabled transit modes (cached). */
function prepare(graph, enabled) {
  const modes = enabled ? [...enabled].sort().join('\u0000') : null;
  let byModes = prepared.get(graph);
  if (!byModes) prepared.set(graph, (byModes = new Map()));
  if (byModes.has(modes)) return byModes.get(modes);

  const stops = graph.stops.length;
  const lines = graph.lines.length;
  const on = graph.lines.map((l) => !enabled || enabled.includes(l.mode));
  const boards = Array.from({ length: stops }, () => []); // stop -> [line, wait]
  const wait = new Float64Array(stops * lines).fill(Infinity);
  for (const [stop, line, minutes] of graph.waits) {
    if (!on[line]) continue;
    boards[stop].push([line, minutes]);
    wait[stop * lines + line] = minutes;
  }
  const rideFrom = new Map(); // stop*lines+line -> [next stop, minutes]
  const rideInto = new Map(); // stop*lines+line -> [previous stop, minutes]
  for (const [line, a, b, minutes] of graph.rides) {
    if (!on[line]) continue;
    append(rideFrom, a * lines + line, [b, minutes]);
    append(rideInto, b * lines + line, [a, minutes]);
  }
  const linesInto = Array.from({ length: stops }, () => []); // lines that can be ridden into a stop
  for (const key of rideInto.keys()) linesInto[Math.floor(key / lines)].push(key % lines);
  const reachableFrom = Array.from({ length: stops }, () => []); // reverse of neighbors, plus the stop itself
  graph.neighbors.forEach((row, s) => {
    reachableFrom[s].push([s, 0]);
    for (const [t, minutes] of row) reachableFrom[t].push([s, minutes]);
  });
  const penalty = graph.lines.map((l) => graph.modes[l.mode].transfer_min);
  const tables = { stops, lines, boards, wait, rideFrom, rideInto, linesInto, reachableFrom, penalty };
  byModes.set(modes, tables);
  return tables;
}

function accessibleStops(graph, point) {
  const out = [];
  graph.stops.forEach((s, i) => {
    const d = distanceM(point, [s.lat, s.lon]);
    if (d <= graph.walk.max_access_m) out.push([i, walkMinutes(d, graph.walk)]);
  });
  return out;
}

/**
 * Search from `point`; returns { out, trace }. With `trace` true, `trace.parent` holds the
 * predecessor node of every settled node (-1 at a root) and `trace.outNode[stop]` the node
 * that produced out[stop], so a path can be rebuilt (see itinerary.js). Off, nothing is recorded.
 */
export function searchStops(graph, point, { enabled = null, reverse = false, trace = false } = {}) {
  const t = prepare(graph, enabled);
  const { stops, lines } = t;
  const total = stops * lines;
  const nodeS = (s) => s;
  const nodeB = (s, l) => stops + s * lines + l;
  const nodeR = (s, l) => stops + total + s * lines + l;
  const best = new Float64Array(stops + 2 * total).fill(Infinity);
  const parent = trace ? new Int32Array(best.length).fill(-1) : null;
  const outNode = trace ? new Int32Array(stops).fill(-1) : null;
  const heap = new MinHeap();
  let current = -1;
  const push = (cost, node) => {
    if (cost < best[node]) {
      best[node] = cost;
      if (parent) parent[node] = current;
      heap.push(cost, node);
    }
  };

  const access = accessibleStops(graph, point);
  if (reverse) {
    for (const [s, minutes] of access) for (const l of t.linesInto[s]) push(minutes, nodeR(s, l));
  } else {
    for (const [s, minutes] of access) push(minutes, nodeS(s));
  }

  const out = new Float64Array(stops).fill(Infinity);
  while (heap.size) {
    const [cost, node] = heap.pop();
    if (cost > best[node]) continue;
    current = node;
    if (node < stops) {
      if (reverse) {
        out[node] = cost;
        if (outNode) outNode[node] = node;
      } else for (const [l, w] of t.boards[node]) push(cost + w, nodeB(node, l));
      continue;
    }
    const isR = node >= stops + total;
    const key = node - stops - (isR ? total : 0);
    const stop = Math.floor(key / lines);
    const line = key % lines;
    if (reverse) {
      if (isR) {
        for (const [a, m] of t.rideInto.get(key) ?? []) {
          push(cost + m, nodeB(a, line));
          if (t.rideInto.has(a * lines + line)) push(cost + m, nodeR(a, line));
        }
      } else {
        push(cost + t.wait[key], nodeS(stop));
        for (const [s, walk] of t.reachableFrom[stop]) {
          for (const l of t.linesInto[s]) {
            if (l !== line) push(cost + t.penalty[line] + walk + t.wait[key], nodeR(s, l));
          }
        }
      }
      continue;
    }
    for (const [next, m] of t.rideFrom.get(key) ?? []) push(cost + m, nodeR(next, line));
    if (!isR) continue;
    if (cost < out[stop]) {
      out[stop] = cost;
      if (outNode) outNode[stop] = node;
    }
    for (const [target, walk] of [[stop, 0], ...graph.neighbors[stop]]) {
      for (const [other, w] of t.boards[target]) {
        if (other !== line) push(cost + t.penalty[other] + walk + w, nodeB(target, other));
      }
    }
  }
  return { out, trace: trace ? { parent, outNode, tables: t } : null };
}

/**
 * Minutes per stop for one point: departing from it (forward, time at which a stop
 * can be left after riding) or arriving at it (reverse, time to reach it from a
 * stop where boarding is possible). Infinity when unreachable.
 */
export function stopTimes(graph, point, options = {}) {
  return searchStops(graph, point, { ...options, trace: false }).out;
}

/**
 * Minutes from `origin` to each point (reverse: from each point to `origin`);
 * null when unreachable. `enabled` lists the transit modes in use (null: all).
 */
export function travelTimes(graph, origin, points, { enabled = null, reverse = false } = {}) {
  const viaStop = stopTimes(graph, origin, { enabled, reverse });
  const { walk } = graph;
  return points.map((p) => {
    let best = Infinity;
    const direct = distanceM(origin, p);
    if (direct <= walk.max_access_m) best = walkMinutes(direct, walk);
    graph.stops.forEach((s, i) => {
      if (viaStop[i] === Infinity) return;
      const d = distanceM([s.lat, s.lon], p);
      if (d <= walk.max_access_m) best = Math.min(best, viaStop[i] + walkMinutes(d, walk));
    });
    return best === Infinity ? null : best;
  });
}
