// Placement of isochrone labels (the contour lines themselves are drawn by the renderer).

const EDGE = { x: 60, y: 24 };
const CLEARANCE = { x: 70, above: 60, below: 40 };

/**
 * Where to write "N min" along a contour: the northmost visible segment midpoint that is on land and clear of
 * `avoid` screen positions (markers, earlier labels). `segments` are pairs of world points; returns
 * { world, at } (world point and screen position) or null.
 */
export function labelSpot(segments, { project, size, avoid = [], isOnLand = () => true }) {
  let best = null;
  for (const [a, b] of segments) {
    const world = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const at = project(world);
    if (at[0] < EDGE.x || at[0] > size.width - EDGE.x || at[1] < EDGE.y || at[1] > size.height - EDGE.y) continue;
    if (avoid.some(([x, y]) => Math.abs(at[0] - x) < CLEARANCE.x && at[1] - y > -CLEARANCE.above && at[1] - y < CLEARANCE.below)) continue;
    if (best && at[1] >= best.at[1]) continue;
    if (!isOnLand(world)) continue;
    best = { world, at };
  }
  return best;
}
