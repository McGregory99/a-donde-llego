// Itinerary panel (R5.1-R5.7): total duration and step list for the chosen point.
import { describeLeg, formatMinutes } from '../i18n.js';

/** Renders `{ graph, state, trip }` into `element` (hidden while no point is chosen). */
export function renderTrip(element, { graph, state, trip }, t) {
  if (!state.destination || !trip) {
    element.hidden = true;
    element.replaceChildren();
    return;
  }
  const title = document.createElement('h2');
  title.textContent = t('itinerary.title');
  const summary = document.createElement('p');
  const children = [title, summary];
  if (trip.reachable) {
    summary.textContent = t('itinerary.total', { minutes: formatMinutes(trip.total) });
    const steps = document.createElement('ol');
    for (const leg of trip.legs) {
      const item = document.createElement('li');
      item.textContent = describeLeg(t, graph, leg);
      steps.append(item);
    }
    children.push(steps);
  } else {
    summary.textContent = t('itinerary.notReachable');
  }
  element.replaceChildren(...children);
  element.hidden = false;
}
