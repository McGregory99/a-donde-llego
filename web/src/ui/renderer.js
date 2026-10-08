// Canvas painting of the map (browser only, thinly tested: the logic it draws lives in the pure modules).
// World coordinates are metres from the projection (x east, y north); the y axis is flipped by the transform.
import { labelSpot } from './contours.js';
import { pointInPolygons } from '../core/geo.js';
import { stopsVisible } from './stops.js';
import { BASE_STYLE, bucketColor, edgeBuckets, pathsVisible, streetWidth, tickHalfPx, ticksVisible } from './street-paint.js';
import { layerCovers, layerFor, layerOffset } from './layer-cache.js';
import { boundsOf, toScreen } from './view.js';

export const COLORS = {
  background: '#f1efe9',
  land: '#e4e2dc',
  water: '#bcd7e8',
  park: 'rgba(120, 180, 90, 0.18)',
  boundary: 'rgba(255, 255, 255, 0.9)',
  contour: '#111111',
  halo: 'rgba(255, 255, 255, 0.92)',
  origin: '#3aa70b',
  destination: '#111111',
  trip: '#1d4ed8',
};
const HEAT_ALPHA = 0.78;
const FIT_MARGIN_M = 1500; // around the outermost stops in the initial view

/** Stable pastel-dark colour per line, so neighbouring lines stay distinguishable without city data. */
export function lineColor(key) {
  let hash = 0;
  for (const char of String(key)) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return `hsl(${hash % 360} 55% 38%)`;
}

/** Appends edge `e` of the street graph to `path` as a world polyline: lower node, shape points, higher node. */
function addEdge(path, walk, world, e) {
  const a = walk.edgeA[e];
  const b = walk.edgeB[e];
  path.moveTo(world.x[a], world.y[a]);
  for (let k = walk.shapeStart[e]; k < walk.shapeStart[e + 1]; k += 1) path.lineTo(world.shapeX[k], world.shapeY[k]);
  path.lineTo(world.x[b], world.y[b]);
}

/** World coordinates of every street node and shape point, plus one base Path2D per road class. */
function streetPaths(walk, toWorld) {
  const x = new Float64Array(walk.n);
  const y = new Float64Array(walk.n);
  for (let i = 0; i < walk.n; i += 1) [x[i], y[i]] = toWorld([walk.lat[i], walk.lon[i]]);
  const shapeX = new Float64Array(walk.shapeLat.length);
  const shapeY = new Float64Array(walk.shapeLat.length);
  for (let k = 0; k < shapeX.length; k += 1) [shapeX[k], shapeY[k]] = toWorld([walk.shapeLat[k], walk.shapeLon[k]]);
  const world = { x, y, shapeX, shapeY };
  const classes = [new Path2D(), new Path2D(), new Path2D()];
  for (let e = 0; e < walk.edges; e += 1) addEdge(classes[walk.edgeCls[e]] ?? classes[1], walk, world, e);
  return { world, classes };
}

const tickOf = (a, b) => {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  return { x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2, dx: (b[0] - a[0]) / length, dy: (b[1] - a[1]) / length };
};

/** Path of ticks centred on their points, `half` world metres either side. */
function tickPath(ticks, half) {
  const path = new Path2D();
  for (const { x, y, dx, dy } of ticks) {
    path.moveTo(x - dx * half, y - dy * half);
    path.lineTo(x + dx * half, y + dy * half);
  }
  return path;
}

const addRing = (path, ring, toWorld) => {
  ring.forEach((point, i) => {
    const [x, y] = toWorld(point);
    if (i) path.lineTo(x, y);
    else path.moveTo(x, y);
  });
  path.closePath();
};

const polygonsPath = (polygons, toWorld) => {
  const path = new Path2D();
  for (const polygon of polygons) for (const ring of polygon) addRing(path, ring, toWorld);
  return path;
};

/** Painter bound to a canvas and the static city assets. */
export function createRenderer(canvas, { data, projection, bbox, graph }) {
  const ctx = canvas.getContext('2d');
  const toWorld = projection.toWorld;
  const boundaryPolygons = data.boundary?.polygons ?? [];
  const [west, south, east, north] = bbox;
  const [minX, minY] = toWorld([south, west]);
  const [maxX, maxY] = toWorld([north, east]);

  const land = boundaryPolygons.length ? polygonsPath(boundaryPolygons, toWorld) : (() => {
    const path = new Path2D();
    path.rect(minX, minY, maxX - minX, maxY - minY);
    return path;
  })();
  const water = (data.basemap?.water ?? []).map((polygon) => polygonsPath([polygon], toWorld));
  const parks = (data.basemap?.parks ?? []).map((polygon) => polygonsPath([polygon], toWorld));
  const lines = data.lines.lines.map((line) => {
    const path = new Path2D();
    line.points.forEach((point, i) => {
      const [x, y] = toWorld(point);
      if (i) path.lineTo(x, y);
      else path.moveTo(x, y);
    });
    return { color: lineColor(line.id.split(':')[0]), path };
  });
  const stops = graph.stops.map((stop) => toWorld([stop.lat, stop.lon]));

  const layers = { heat: null, contours: [], trip: null, streetTimes: null };
  const layer = { canvas: null, valid: null };
  const walk = graph.walk?.network === 'streets' ? graph.streets : null;
  const streetBase = walk ? streetPaths(walk, toWorld) : null;

  function worldTransform(view, size, dpr, target = ctx) {
    target.setTransform(
      dpr * view.scale, 0, 0, -dpr * view.scale,
      dpr * (size.width / 2 - view.cx * view.scale),
      dpr * (size.height / 2 + view.cy * view.scale),
    );
  }

  function haloText(text, x, y, color) {
    ctx.font = '700 12px Inter, system-ui, sans-serif';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = COLORS.halo;
    ctx.lineWidth = 5;
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }

  function marker(view, size, { point, color, label }) {
    const [x, y] = toScreen(view, size, toWorld(point));
    ctx.beginPath();
    ctx.arc(x, y, 15, 0, Math.PI * 2);
    ctx.fillStyle = `${color}2e`;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, 8, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
    if (!label) return;
    ctx.font = '700 12px Inter, system-ui, sans-serif';
    const width = ctx.measureText(label).width + 16;
    const left = Math.min(Math.max(x - width / 2, 6), size.width - width - 6);
    ctx.beginPath();
    ctx.roundRect(left, y - 42, width, 22, 7);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, left + width / 2, y - 30.5);
  }

  /** Streets in the neutral style, then every edge with a travel time over it in its colour. */
  function paintStreets(target, view, size) {
    const px = 1 / view.scale;
    worldTransform(view, size, size.dpr, target);
    target.save();
    target.clip(land, 'evenodd'); // streets are only drawn inside the city boundary, like the heat was
    target.lineCap = 'round';
    target.lineJoin = 'round';
    BASE_STYLE.forEach((style, cls) => {
      if (cls === 0 && !pathsVisible(view.scale)) return;
      target.strokeStyle = style.color;
      target.lineWidth = streetWidth(cls, view.scale) * px;
      target.setLineDash(style.dash ? [4 * px, 3 * px] : []);
      target.stroke(streetBase.classes[cls]);
    });
    target.setLineDash([]);
    if (layers.streetTimes) {
      layers.streetTimes.forEach((paths, cls) => {
        if (cls === 0 && !pathsVisible(view.scale)) return;
        target.lineWidth = streetWidth(cls, view.scale) * px;
        paths.forEach(({ color, path }) => {
          target.strokeStyle = color;
          target.stroke(path);
        });
      });
    }
    target.restore();
  }

  // Painting every segment takes tens of milliseconds, so the streets go through an off-screen layer a bit larger
  // than the viewport: panning copies its pixels at an integer offset (layer-cache.js) and only a zoom, a new
  // travel-time set or a pan beyond the margin repaints it. Too big a canvas (huge screens): paint directly.
  function drawStreets(view, size) {
    if (!layer.canvas || !layer.valid || !layerCovers(layer.valid, view, size)) {
      const next = layerFor(view, size);
      layer.valid = null;
      if (!next) {
        paintStreets(ctx, view, size);
        return;
      }
      layer.canvas ??= document.createElement('canvas');
      layer.canvas.width = next.pxWidth;
      layer.canvas.height = next.pxHeight;
      const target = layer.canvas.getContext('2d');
      paintStreets(target, view, { width: next.pxWidth / next.dpr, height: next.pxHeight / next.dpr, dpr: next.dpr });
      layer.valid = next;
    }
    const { x, y } = layerOffset(layer.valid, view, size);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(layer.canvas, x, y);
    worldTransform(view, size, size.dpr); // the layers drawn after the streets paint in world metres
  }

  function drawContours(view, size, markers) {
    const px = 1 / view.scale;
    const avoid = markers.map(({ point }) => toScreen(view, size, toWorld(point)));
    const labels = [];
    for (const { minutes, path: fixedPath, segments, ticks } of layers.contours) {
      if (!segments.length || (ticks && !ticksVisible(view.scale))) continue;
      const path = ticks ? tickPath(ticks, tickHalfPx(view.scale) * px) : fixedPath;
      worldTransform(view, size, size.dpr);
      ctx.save();
      ctx.clip(land, 'evenodd');
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.lineWidth = 4.5 * px;
      ctx.stroke(path);
      ctx.strokeStyle = COLORS.contour;
      ctx.lineWidth = (minutes >= 30 ? 2 : 1.4) * px;
      ctx.stroke(path);
      ctx.restore();
      const spot = labelSpot(segments, {
        project: (world) => toScreen(view, size, world),
        size,
        avoid: [...avoid, ...labels.map((label) => label.at)],
        isOnLand: (world) => !boundaryPolygons.length || pointInPolygons(boundaryPolygons, projection.toLatLon(world)),
      });
      if (spot) labels.push({ minutes, at: spot.at });
    }
    return labels;
  }

  return {
    /** Heat raster: `image` = {width, height, data} from heatPixels, covering the bbox. */
    setHeat(image) {
      if (!image) {
        layers.heat = null;
        return;
      }
      const heat = layers.heat?.canvas ?? document.createElement('canvas');
      heat.width = image.width;
      heat.height = image.height;
      heat.getContext('2d').putImageData(new ImageData(image.data, image.width, image.height), 0, 0);
      layers.heat = { canvas: heat };
    },

    /**
     * Street travel times: `times` = minutes per street node (Infinity unreachable), `maxMinutes` the colour scale.
     * Edges are grouped by road class and colour bucket so a frame costs a few dozen strokes, not one per edge.
     */
    setStreetTimes(times, maxMinutes) {
      if (!walk) return;
      const buckets = edgeBuckets(walk, times, maxMinutes);
      const grouped = [0, 1, 2].map(() => new Map());
      for (let e = 0; e < walk.edges; e += 1) {
        const bucket = buckets[e];
        if (bucket < 0) continue;
        const byBucket = grouped[walk.edgeCls[e]] ?? grouped[1];
        let entry = byBucket.get(bucket);
        if (!entry) byBucket.set(bucket, (entry = { color: bucketColor(bucket, maxMinutes), path: new Path2D() }));
        addEdge(entry.path, walk, streetBase.world, e);
      }
      layer.valid = null; // the off-screen street layer shows the old times
      layers.streetTimes = grouped.map((byBucket) => [...byBucket.entries()].sort((a, b) => a[0] - b[0]).map(([, entry]) => entry));
    },

    /** Contour segments per threshold, as returned by isochrones(): { [minutes]: [[[lat, lon], [lat, lon]], ...] }. */
    setContours(contours) {
      layers.contours = Object.entries(contours)
        .map(([minutes, segments]) => {
          const worldSegments = segments.map(([a, b]) => [toWorld(a), toWorld(b)]);
          const path = new Path2D();
          for (const [a, b] of worldSegments) {
            path.moveTo(a[0], a[1]);
            path.lineTo(b[0], b[1]);
          }
          // On streets a front is a tick across each crossing street: drawn a fixed few pixels long, whatever the zoom.
          const ticks = walk ? worldSegments.map(([a, b]) => tickOf(a, b)) : null;
          return { minutes: Number(minutes), path, segments: worldSegments, ticks };
        })
        .sort((a, b) => a.minutes - b.minutes);
    },

    /** Highlighted itinerary path ([[lat, lon], ...]) or null. */
    setTrip(points) {
      layers.trip = points?.length > 1 ? points.map(toWorld) : null;
    },

    /** Paints one frame. `markers` = [{point: [lat, lon], color, label}] drawn in order (last on top). */
    draw(view, size, markers, { contourLabel }) {
      const { width, height, dpr } = size;
      const px = 1 / view.scale;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = COLORS.background;
      ctx.fillRect(0, 0, width, height);

      worldTransform(view, size, dpr);
      ctx.fillStyle = COLORS.land;
      ctx.fill(land, 'evenodd');
      if (layers.heat && !walk) {
        ctx.save();
        ctx.clip(land, 'evenodd'); // never paint outside the city boundary
        ctx.globalAlpha = HEAT_ALPHA;
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(layers.heat.canvas, minX, minY, maxX - minX, maxY - minY);
        ctx.restore();
      }
      ctx.fillStyle = COLORS.park;
      for (const park of parks) ctx.fill(park, 'evenodd');
      ctx.fillStyle = COLORS.water;
      for (const body of water) ctx.fill(body, 'evenodd');
      ctx.strokeStyle = COLORS.boundary;
      ctx.lineWidth = 1.1 * px;
      ctx.stroke(land);
      if (walk) drawStreets(view, size);

      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.globalAlpha = walk ? 0.6 : 0.8;
      for (const line of lines) {
        ctx.strokeStyle = line.color;
        ctx.lineWidth = (walk ? 1.6 : 2) * px;
        ctx.stroke(line.path);
      }
      ctx.globalAlpha = 1;

      const labels = drawContours(view, size, markers);
      if (layers.trip) {
        worldTransform(view, size, dpr);
        const path = new Path2D();
        layers.trip.forEach(([x, y], i) => (i ? path.lineTo(x, y) : path.moveTo(x, y)));
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 7 * px;
        ctx.stroke(path);
        ctx.strokeStyle = COLORS.trip;
        ctx.lineWidth = 4 * px;
        ctx.stroke(path);
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (stopsVisible(view)) {
        ctx.fillStyle = 'rgba(40, 40, 40, 0.8)';
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        for (const world of stops) {
          const [x, y] = toScreen(view, size, world);
          if (x < -4 || y < -4 || x > width + 4 || y > height + 4) continue;
          ctx.beginPath();
          ctx.arc(x, y, 3, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      }
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const { minutes, at } of labels) haloText(contourLabel(minutes), at[0], at[1], COLORS.contour);
      for (const item of markers) marker(view, size, item);
    },

    /** Area the initial view shows, in world metres: the served area (stops plus margin), else the whole bbox. */
    bounds: boundsOf(stops, FIT_MARGIN_M) ?? [minX, minY, maxX, maxY],
  };
}
