// View-state reducer: every user intent is an action, the state stays a plain serialisable value
// (the same shape as state-url.js, so it can be shared as a link).
import { ISOCHRONE_CHOICES, SCALE } from '../state-url.js';

const inside = ([west, south, east, north], [lat, lon]) => lat >= south && lat <= north && lon >= west && lon <= east;

/** Next state for `action`; returns the same object when nothing changes. `city` comes from cityDefaults. */
export function reduce(state, action, city) {
  switch (action.type) {
    case 'origin':
      return inside(city.bbox, action.point) ? { ...state, origin: [...action.point] } : state;
    case 'destination':
      if (action.point === null) return { ...state, destination: null };
      return inside(city.bbox, action.point) ? { ...state, destination: [...action.point] } : state;
    case 'invert':
      return { ...state, direction: state.direction === 'departure' ? 'arrival' : 'departure' };
    case 'mode': {
      if (!city.modes.includes(action.id)) return state;
      const on = state.modes.includes(action.id);
      const modes = city.modes.filter((id) => (id === action.id ? !on : state.modes.includes(id)));
      return { ...state, modes };
    }
    case 'iso': {
      if (!ISOCHRONE_CHOICES.includes(action.minutes)) return state;
      const on = state.isochrones.includes(action.minutes);
      const isochrones = ISOCHRONE_CHOICES.filter((m) => (m === action.minutes ? !on : state.isochrones.includes(m)));
      return { ...state, isochrones };
    }
    case 'scale': {
      if (!Number.isFinite(action.value)) return state;
      return { ...state, scale: Math.min(SCALE.max, Math.max(SCALE.min, Math.round(action.value))) };
    }
    case 'replace':
      return action.state;
    default:
      throw new Error(`state: unknown action "${action.type}"`);
  }
}
