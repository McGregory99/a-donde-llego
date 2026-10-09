// Application: state container + scene recomputation + wiring of map, legend and URL (R4.x, R7.3).
import { createGrid } from '../core/grid.js';
import { pointInPolygons } from '../core/geo.js';
import { t as defaultT } from '../i18n.js';
import { cityDefaults, parseState, serializeState } from '../state-url.js';
import { heatPixels } from './heat.js';
import { legendModel, renderLegend } from './legend.js';
import { buildLayout } from './layout.js';
import { createMap } from './map.js';
import { createRenderer, COLORS } from './renderer.js';
import { computeScene, destinationTrip, sceneContours } from './scene.js';
import { reduce } from './state.js';
import { bindDismiss } from './dismiss.js';
import { createToast } from './toast.js';
import { createProjection } from './view.js';

const CELL_M = 100;
const HEAT_UPSAMPLE = { full: 3, drag: 1 };

const inBbox = ([west, south, east, north], [lat, lon]) => lat >= south && lat <= north && lon >= west && lon <= east;

/**
 * Mounts the app on `root`. `config` is the city config, `data` the loaded assets. Returns
 * { getState, dispatch, subscribe, layout, notify, inCity, map } for the control modules.
 */
export function createApp({ config, data, root, search = '', t = defaultT, history = window.history, location = window.location }) {
  const city = cityDefaults(config);
  const projection = createProjection(config.center);
  const grid = createGrid(config.bbox, CELL_M);
  const layout = buildLayout(root, t);
  const notify = createToast(layout.toast);
  const { state: initial, ignored } = parseState(search, city);

  let state = initial;
  let scene = null;
  let trip = null;
  const listeners = new Set();

  const inCity = (point) =>
    inBbox(config.bbox, point) && (!data.boundary.polygons.length || pointInPolygons(data.boundary.polygons, point));

  const renderer = createRenderer(layout.canvas, { data, projection, bbox: config.bbox, graph: data.graph });

  function paintHeat(upsample) {
    if (scene.nodes) renderer.setStreetTimes(scene.nodes, state.scale);
    else renderer.setHeat(heatPixels(scene.times, grid.cols, grid.rows, state.scale, upsample));
  }

  /** Recomputes only what `previous` -> `state` invalidated. */
  function refresh(previous, { fast = false } = {}) {
    const moved =
      !scene ||
      previous.origin !== state.origin ||
      previous.direction !== state.direction ||
      previous.modes !== state.modes ||
      (previous.scale !== state.scale && !state.modes.length); // walk-only reach is bounded by the scale
    if (moved) {
      scene = computeScene(data.graph, grid, state);
      renderer.setContours(scene.contours);
      paintHeat(fast ? HEAT_UPSAMPLE.drag : HEAT_UPSAMPLE.full);
    } else {
      if (previous.isochrones !== state.isochrones) {
        scene = { ...scene, contours: sceneContours(data.graph, grid, scene, state.isochrones) };
        renderer.setContours(scene.contours);
      }
      if (previous.scale !== state.scale) paintHeat(HEAT_UPSAMPLE.full);
    }
    trip = destinationTrip(data.graph, state);
    renderer.setTrip(trip?.reachable ? trip.path : null);
  }

  function markers() {
    const arrival = state.direction === 'arrival';
    const list = [
      { key: 'origin', point: state.origin, color: COLORS.origin, draggable: true, label: t(arrival ? 'controls.arrival' : 'controls.departure') },
    ];
    if (state.destination) {
      const label = trip?.reachable ? t('legend.minutes', { minutes: Math.max(1, Math.round(trip.total)) }) : null;
      list.push({ key: 'destination', point: state.destination, color: COLORS.destination, draggable: false, label });
    }
    return list;
  }

  function syncUrl() {
    history.replaceState(null, '', `?${serializeState(state)}`);
  }

  function emit() {
    renderLegend(layout.legend, legendModel(state), t);
    map.requestRender();
    for (const listener of listeners) listener(state, { trip });
  }

  function dispatch(action, options = {}) {
    const previous = state;
    state = reduce(state, action, city);
    if (state === previous) return;
    refresh(previous, options);
    if (!options.quiet) syncUrl();
    emit();
  }

  function showStopName(index, screen) {
    const name = index === null ? '' : data.graph.stops[index]?.name;
    layout.tooltip.hidden = !name;
    if (!name) return;
    layout.tooltip.textContent = name;
    layout.tooltip.style.left = `${screen[0]}px`;
    layout.tooltip.style.top = `${screen[1]}px`;
  }

  const map = createMap({
    canvas: layout.canvas,
    renderer,
    projection,
    getMarkers: markers,
    stops: data.graph.stops.map((stop) => ({ point: [stop.lat, stop.lon] })),
    contourLabel: (minutes) => t('isochrone.label', { minutes }),
    handlers: {
      onClick: (point) => (inCity(point) ? dispatch({ type: 'destination', point }) : notify(t('errors.outOfBounds'))),
      onDrag: (key, point) => {
        if (key === 'origin' && inCity(point)) dispatch({ type: 'origin', point }, { quiet: true, fast: true });
      },
      onDragEnd: () => {
        paintHeat(HEAT_UPSAMPLE.full);
        syncUrl();
        emit();
      },
      onMarkerClick: (key) => key === 'destination' && dispatch({ type: 'destination', point: null }),
      onStopFocus: showStopName,
      onDoubleClick: (key) => key === 'destination' && dispatch({ type: 'destination', point: null }),
    },
  });

  layout.zoom.addEventListener('click', (event) => {
    const action = event.target.closest('button')?.dataset.action;
    if (action === 'zoom-in') map.zoomIn();
    else if (action === 'zoom-out') map.zoomOut();
    else if (action === 'recenter') map.recenter();
  });

  bindDismiss(document, { getState: () => state, dispatch });

  refresh(state, {});
  emit();
  if (ignored.length) notify(t('errors.invalidLink'));

  return {
    getState: () => state,
    dispatch,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    layout,
    notify,
    inCity,
    map,
    city,
    projection,
    trip: () => trip,
  };
}
