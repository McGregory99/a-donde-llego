// "En cifras" panel and the expired-feed banner (R8.1, R8.2, R8.4, R8.5). Values come from the build's stats.json.
import { t as defaultT } from '../i18n.js';

const number = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 });

/** "2026-10-07" -> "07/10/2026" (day first, deterministic across runtimes). */
export function formatDate(iso) {
  const [year, month, day] = String(iso).split('-');
  return `${day}/${month}/${year}`;
}

function node(tag, attributes = {}, children = []) {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (name === 'text') element.textContent = value;
    else element.setAttribute(name, value);
  }
  element.append(...children);
  return element;
}

/** Fills `container` with the aggregates computed at build time and the definitions that make them readable. */
export function renderStats(container, stats, t = defaultT) {
  const { reach, headway, feed } = stats;
  const rows = [
    ['reach', t('stats.reach', { minutes: reach.threshold_min }), t('stats.percent', { value: number.format(reach.percent_stops) })],
    ['headway', t('stats.headway'), t('stats.minutes', { value: number.format(headway.overall_median_min) })],
    ['stops', t('stats.stops'), number.format(stats.stops)],
    ['lines', t('stats.lines'), number.format(stats.lines)],
    ['validity', t('stats.validityLabel'), t('stats.validity', { from: formatDate(feed.valid_from), to: formatDate(feed.valid_to) })],
  ];
  const definitions = [
    t(`stats.reachDefinition.${reach.scope}`, { minutes: reach.threshold_min }),
    ...(reach.origins > 1 ? [t('stats.reachOrigins', { count: reach.origins })] : []),
    t('stats.headwayDefinition'),
  ];
  container.replaceChildren(
    node('h2', { text: t('stats.title') }),
    node(
      'dl',
      { class: 'stats-figures' },
      rows.flatMap(([key, label, value]) => [node('dt', { text: label }), node('dd', { 'data-stat': key, text: value })]),
    ),
    node('h3', { text: t('stats.definitionsTitle') }),
    node('ul', { class: 'stats-definitions' }, definitions.map((text) => node('li', { text }))),
    node('p', { class: 'stats-built', text: t('stats.builtOn', { date: formatDate(stats.built_on) }) }),
  );
}

/** Shows a visible warning with the feed end date when `meta.feed.expired`, otherwise hides and empties `container`. */
export function renderExpiryBanner(container, meta, t = defaultT) {
  const expired = Boolean(meta?.feed?.expired);
  container.hidden = !expired;
  container.textContent = expired ? t('stats.expired', { date: formatDate(meta.feed.valid_to) }) : '';
  if (expired) container.setAttribute('role', 'alert');
  else container.removeAttribute('role');
}
