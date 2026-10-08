// Legend (R4.5, R4.6): colour scale, contours and travel direction.
import { legendGradient } from './color.js';

/** Plain description of what the legend shows for a view state. */
export function legendModel(state) {
  return {
    captionKey: `legend.${state.direction === 'arrival' ? 'arrival' : 'departure'}${state.modes.length ? '' : 'Walk'}`,
    ticks: [0, Math.round(state.scale / 2), state.scale],
    contours: [...state.isochrones].sort((a, b) => a - b),
  };
}

/** Fills `element` with the legend for `model`, text from translator `t`. */
export function renderLegend(element, model, t) {
  const make = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const bar = make('div', 'legend-bar');
  bar.style.background = legendGradient();
  const ticks = make('div', 'legend-ticks');
  for (const minutes of model.ticks) ticks.append(make('span', '', t('legend.minutes', { minutes })));
  element.replaceChildren(make('p', 'legend-caption', t(model.captionKey)), bar, ticks);
  if (model.contours.length) {
    const entry = make('p', 'legend-contours', t('legend.contours'));
    entry.append(' ', ...model.contours.map((minutes) => make('span', 'legend-iso', t('isochrone.label', { minutes }))));
    element.append(entry);
  }
}
