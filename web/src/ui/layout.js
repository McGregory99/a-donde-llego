// Page skeleton, built from translations so no user-visible text is hardcoded (R4.9).
import { t as defaultT } from '../i18n.js';

function el(tag, attributes = {}, children = []) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (name === 'text') node.textContent = value;
    else node.setAttribute(name, value);
  }
  node.append(...children);
  return node;
}

/** Fills `root` with header, expiry banner, map stage (legend, messages, attribution) and stats area; returns the pieces the app wires up. */
export function buildLayout(root, t = defaultT) {
  document.title = t('app.title');
  const controls = el('div', { class: 'controls' });
  const canvas = el('canvas', { id: 'map', 'aria-label': t('app.mapLabel'), role: 'img' });
  const zoom = el('div', { class: 'zoom' }, [
    el('button', { type: 'button', 'data-action': 'zoom-in', 'aria-label': t('controls.zoomIn'), text: '+' }),
    el('button', { type: 'button', 'data-action': 'zoom-out', 'aria-label': t('controls.zoomOut'), text: '−' }),
    el('button', { type: 'button', 'data-action': 'recenter', 'aria-label': t('controls.recenter'), text: '⌖' }),
  ]);
  const legend = el('div', { class: 'legend' });
  const panel = el('aside', { class: 'trip-panel', 'aria-live': 'polite', hidden: '' });
  const toast = el('div', { class: 'toast', role: 'status', hidden: '' });
  const attribution = el('div', { class: 'attribution' });
  const stage = el('div', { class: 'stage' }, [canvas, zoom, legend, panel, toast, attribution]);
  const header = el('header', {}, [el('h1', { text: t('app.title') }), el('p', { text: t('app.subtitle') })]);
  const banner = el('div', { class: 'expiry-banner', hidden: '' });
  const stats = el('section', { class: 'stats' });
  root.replaceChildren(header, banner, controls, stage, stats);
  return { controls, canvas, zoom, legend, panel, toast, stage, banner, stats, attribution };
}
