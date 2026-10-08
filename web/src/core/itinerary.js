// Step-by-step itinerary behind a heat-map value (R5.1-R5.6).
//
// The total is computed exactly like travelTimes (walk straight there, or the
// cheapest stop-search time plus the walk), so it always equals the map value;
// the legs are rebuilt from the predecessor chain of the same search and sum to it.
// Legs are structured data, never text: the UI turns them into strings via i18n.
//
//   { type: 'walk',     minutes, from: End, to: End }          End = { stop: index|null, point: [lat, lon] }
//   { type: 'wait',     minutes, stop, line }
//   { type: 'ride',     minutes, line, from, to, stops: [stop indices, boarding to alighting] }
//   { type: 'transfer', minutes, walkMinutes, penaltyMinutes, fromStop, toStop }
// `stop` / `line` are indices into graph.stops / graph.lines.
import { searchStops } from './dijkstra.js';
import { distanceM, walkMinutes } from './geo.js';

const stopPoint = (graph, stop) => [graph.stops[stop].lat, graph.stops[stop].lon];

/** Decodes a search node: S(stop) walked-to, B(stop, line) boarded, R(stop, line) after a ride hop. */
function decode(node, tables) {
  const { stops, lines } = tables;
  if (node < stops) return { kind: 'S', stop: node, line: -1 };
  const total = stops * lines;
  const isR = node >= stops + total;
  const key = node - stops - (isR ? total : 0);
  return { kind: isR ? 'R' : 'B', stop: Math.floor(key / lines), line: key % lines };
}

/** Minutes of the edge towards `target` in `edges` ([target, minutes] pairs); throws a clear error if absent. */
export function edgeMinutes(edges, target, label) {
  const edge = edges?.find(([next]) => next === target);
  if (!edge) throw new Error(`itinerary: inconsistent graph, missing edge (${label})`);
  return edge[1];
}

/** Nodes from `node` back to its root, via predecessors. */
function chainOf(parent, node) {
  const chain = [];
  for (let n = node; n !== -1; n = parent[n]) chain.push(n);
  return chain;
}

function walkLeg(graph, from, to) {
  const distance = distanceM(from.point, to.point);
  return distance === 0 ? [] : [{ type: 'walk', minutes: walkMinutes(distance, graph.walk), from, to }];
}

function transitLegs(graph, nodes, tables) {
  const legs = [];
  const { lines } = tables;
  for (let k = 1; k < nodes.length; k += 1) {
    const a = decode(nodes[k - 1], tables);
    const b = decode(nodes[k], tables);
    if (a.kind === 'S') {
      legs.push({ type: 'wait', minutes: tables.wait[b.stop * lines + b.line], stop: b.stop, line: b.line });
    } else if (b.kind === 'R' && a.line === b.line) {
      const hop = edgeMinutes(tables.rideFrom.get(a.stop * lines + a.line), b.stop, `ride ${a.stop} -> ${b.stop}`);
      const last = legs.at(-1);
      if (last?.type === 'ride' && last.line === a.line && last.to === a.stop) {
        last.minutes += hop;
        last.to = b.stop;
        last.stops.push(b.stop);
      } else {
        legs.push({ type: 'ride', minutes: hop, line: a.line, from: a.stop, to: b.stop, stops: [a.stop, b.stop] });
      }
    } else {
      // R(s, l) -> B(t, o): alight, walk to t, pay o's penalty, then wait for o.
      const walk = a.stop === b.stop ? 0 : edgeMinutes(graph.neighbors[a.stop], b.stop, `walk ${a.stop} -> ${b.stop}`);
      const penalty = tables.penalty[b.line];
      legs.push({
        type: 'transfer', minutes: penalty + walk, walkMinutes: walk, penaltyMinutes: penalty,
        fromStop: a.stop, toStop: b.stop,
      });
      legs.push({ type: 'wait', minutes: tables.wait[b.stop * lines + b.line], stop: b.stop, line: b.line });
    }
  }
  return legs;
}

/** Map polyline: every stop the legs pass through, from trip start to trip end. */
function pathOf(graph, start, legs, end) {
  const path = [start];
  const add = (point) => {
    const last = path.at(-1);
    if (last[0] !== point[0] || last[1] !== point[1]) path.push(point);
  };
  for (const leg of legs) {
    if (leg.type === 'walk') add(leg.to.point);
    else if (leg.type === 'ride') leg.stops.forEach((s) => add(stopPoint(graph, s)));
    else if (leg.type === 'transfer') add(stopPoint(graph, leg.toStop));
  }
  add(end);
  return path;
}

/**
 * Itinerary behind the heat-map value at `point`, or null when it is unreachable.
 * Departure (default): `anchor` is the departure, the trip runs anchor -> point.
 * Arrival (`reverse`): `anchor` is the chosen destination, the trip runs point -> anchor.
 * Returns { total, legs, path } with legs in travel order.
 */
export function itinerary(graph, anchor, point, { enabled = null, reverse = false } = {}) {
  const { out, trace } = searchStops(graph, anchor, { enabled, reverse, trace: true });
  const { walk } = graph;
  const start = reverse ? point : anchor;
  const end = reverse ? anchor : point;

  let best = Infinity;
  let via = -1;
  const direct = distanceM(anchor, point);
  if (direct <= walk.max_access_m) best = walkMinutes(direct, walk);
  graph.stops.forEach((s, i) => {
    if (out[i] === Infinity) return;
    const d = distanceM([s.lat, s.lon], point);
    if (d > walk.max_access_m) return;
    const total = out[i] + walkMinutes(d, walk);
    if (total < best) {
      best = total;
      via = i;
    }
  });
  if (best === Infinity) return null;

  const at = (stop, p) => ({ stop, point: p ?? stopPoint(graph, stop) });
  if (via === -1) {
    const legs = walkLeg(graph, at(null, start), at(null, end));
    return { total: best, legs, path: pathOf(graph, start, legs, end) };
  }

  const chain = chainOf(trace.parent, trace.outNode[via]);
  const nodes = reverse ? chain : chain.reverse(); // arrival chains already run in travel order
  const first = decode(nodes[0], trace.tables).stop;
  const last = decode(nodes.at(-1), trace.tables).stop;
  const legs = [
    ...walkLeg(graph, at(null, start), at(first)),
    ...transitLegs(graph, nodes, trace.tables),
    ...walkLeg(graph, at(last), at(null, end)),
  ];
  return { total: best, legs, path: pathOf(graph, start, legs, end) };
}
