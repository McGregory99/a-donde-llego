// Translations: a dictionary of dotted keys plus a tiny t(key, vars). Adding a locale means
// adding web/i18n/<locale>.json and building a translator from it with createT.
import es from '../i18n/es.json';

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

function lookup(dictionary, key) {
  let node = dictionary;
  for (const part of key.split('.')) {
    if (node === null || typeof node !== 'object' || !hasOwn(node, part)) return undefined;
    node = node[part];
  }
  return typeof node === 'string' ? node : undefined;
}

/** Translator for `dictionary`: t(key, vars) fills {name} placeholders; a missing key yields the key. */
export function createT(dictionary) {
  const t = (key, vars = {}) => {
    const template = lookup(dictionary, key);
    if (template === undefined) return key;
    return template.replace(/\{(\w+)\}/g, (match, name) => (hasOwn(vars, name) ? String(vars[name]) : match));
  };
  t.has = (key) => lookup(dictionary, key) !== undefined;
  return t;
}

/** Default (Spanish) translator. */
export const t = createT(es);

/** Whole minutes for display (R5.7); a positive duration never shows as 0. */
export function formatMinutes(minutes) {
  return minutes > 0 ? Math.max(1, Math.round(minutes)) : 0;
}

/** Mode label from the resources (key `modes.<id>`), or the id itself when untranslated. */
export function modeLabel(id, translate = t) {
  const key = `modes.${id}`;
  return translate.has(key) ? translate(key) : id;
}

const stopName = (graph, index) => graph.stops[index]?.name || String(index);
const lineLabel = (graph, index) => graph.lines[index]?.name || graph.lines[index]?.route_id || String(index);

/** Spanish sentence for one structured itinerary leg (see core/itinerary.js). */
export function describeLeg(translate, graph, leg) {
  const minutes = formatMinutes(leg.minutes);
  switch (leg.type) {
    case 'walk':
      return leg.to.stop === null
        ? translate('legs.walk.toPoint', { minutes })
        : translate('legs.walk.toStop', { minutes, stop: stopName(graph, leg.to.stop) });
    case 'wait':
      return translate('legs.wait', { minutes, stop: stopName(graph, leg.stop), line: lineLabel(graph, leg.line) });
    case 'ride': {
      const route = graph.lines[leg.line]?.long_name;
      const vars = { minutes, line: lineLabel(graph, leg.line), from: stopName(graph, leg.from), to: stopName(graph, leg.to) };
      return route ? translate('legs.ride.route', { ...vars, route }) : translate('legs.ride.plain', vars);
    }
    case 'transfer':
      return leg.fromStop === leg.toStop
        ? translate('legs.transfer.same', { minutes, stop: stopName(graph, leg.fromStop) })
        : translate('legs.transfer.walk', {
            minutes,
            from: stopName(graph, leg.fromStop),
            to: stopName(graph, leg.toStop),
          });
    default:
      throw new Error(`i18n: unknown itinerary leg type "${leg.type}"`);
  }
}
