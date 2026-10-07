// @vitest-environment jsdom
// R5.1-R5.7: the itinerary panel shows total, step list, or the not-reachable message.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { describeLeg, t } from '../../src/i18n.js';
import { destinationTrip } from '../../src/ui/scene.js';
import { renderTrip } from '../../src/ui/panel.js';

const { graph } = JSON.parse(readFileSync(new URL('../golden/travel_times.json', import.meta.url), 'utf8'));
const base = { origin: [41.6, -4.7], direction: 'departure', modes: ['road', 'rail'], scale: 120, destination: null };
const far = [41.6, -4.627923498088196];

const render = (state) => {
  const el = document.createElement('aside');
  renderTrip(el, { graph, state, trip: destinationTrip(graph, state) }, t);
  return el;
};

describe('renderTrip', () => {
  it('is hidden until a point is chosen', () => {
    expect(render(base).hidden).toBe(true);
  });

  it('shows the total in whole minutes and one step per leg, in Spanish (R5.1, R5.2, R5.7)', () => {
    const state = { ...base, destination: far };
    const trip = destinationTrip(graph, state);
    const el = render(state);
    expect(el.hidden).toBe(false);
    expect(el.textContent).toContain(t('itinerary.title'));
    expect(el.textContent).toContain(t('itinerary.total', { minutes: Math.max(1, Math.round(trip.total)) }));
    const steps = [...el.querySelectorAll('li')].map((li) => li.textContent);
    expect(steps).toEqual(trip.legs.map((leg) => describeLeg(t, graph, leg)));
  });

  it('says the point is not reachable and lists no steps when it is beyond the scale (R5.5)', () => {
    const el = render({ ...base, destination: far, scale: 5 });
    expect(el.hidden).toBe(false);
    expect(el.textContent).toContain(t('itinerary.notReachable'));
    expect(el.querySelectorAll('li')).toHaveLength(0);
  });

  it('re-rendering replaces the previous content', () => {
    const el = document.createElement('aside');
    const state = { ...base, destination: far };
    renderTrip(el, { graph, state, trip: destinationTrip(graph, state) }, t);
    renderTrip(el, { graph, state: base, trip: null }, t);
    expect(el.hidden).toBe(true);
    expect(el.querySelectorAll('li')).toHaveLength(0);
  });
});
