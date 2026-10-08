// Control bar wired to the app: search, my position, invert, share, travel mode, contours and scale.
import { modeLabel } from '../i18n.js';
import { ISOCHRONE_CHOICES, SCALE } from '../state-url.js';
import { createSearch } from './search.js';
import { travelChoice } from './state.js';

function el(tag, attributes = {}, children = []) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (name === 'text') node.textContent = value;
    else node.setAttribute(name, value);
  }
  node.append(...children);
  return node;
}

/** A labelled checkbox; `dataset` entries become data-* attributes. */
function checkbox(text, data) {
  const input = el('input', { type: 'checkbox' });
  Object.assign(input.dataset, data);
  return { input, label: el('label', {}, [input, ' ', text]) };
}

/**
 * Mounts the controls in `container`. `app` = createApp()'s API; `parts` = { geocoder, locate(isInside) -> Promise<[lat, lon]>,
 * share(url, title) -> Promise<'shared'|'cancelled'|'copied'>, shareUrl(state) -> string, t }.
 */
export function createControls(container, app, { geocoder, locate, share, shareUrl, t }) {
  createSearch(container, {
    geocoder,
    t,
    onSelect: ({ lat, lon }) => {
      app.dispatch({ type: 'origin', point: [lat, lon] });
      app.map.reveal([lat, lon]);
    },
    onError: (key) => app.notify(t(key)),
  });

  const button = (action, text) => el('button', { type: 'button', 'data-action': action, text });
  const locateButton = button('locate', t('controls.myPosition'));
  const invertButton = button('invert', t('controls.invert'));
  const shareButton = button('share', t('controls.share'));

  locateButton.addEventListener('click', async () => {
    try {
      const point = await locate(app.inCity);
      app.dispatch({ type: 'origin', point });
      app.map.reveal(point);
    } catch (error) {
      app.notify(t(error?.key ?? 'errors.geolocationUnavailable'));
    }
  });
  invertButton.addEventListener('click', () => app.dispatch({ type: 'invert' }));
  shareButton.addEventListener('click', async () => {
    try {
      const result = await share(shareUrl(app.getState()), t('app.title'));
      if (result === 'copied') app.notify(t('controls.shareCopied'));
    } catch (error) {
      app.notify(t(error?.key ?? 'errors.shareFailed'));
    }
  });

  // Explicit choice instead of per-mode checkboxes: every transit mode plus walking, or walking only.
  const transitName = app.city.modes.map((id) => modeLabel(id, t)).join(' / ');
  const choices = [
    ...(app.city.modes.length ? [['transit', t('controls.withWalk', { transit: transitName })]] : []),
    ['walk', t('controls.walkOnly')],
  ];
  const modes = el('div', { class: 'segmented', role: 'radiogroup', 'aria-label': t('controls.modes') });
  const modeRadios = choices.map(([choice, text]) => {
    const input = el('input', { type: 'radio', name: 'travel-mode' });
    input.dataset.travel = choice;
    input.addEventListener('change', () => input.checked && app.dispatch({ type: 'travel', choice }));
    modes.append(el('label', {}, [input, el('span', { text })]));
    return input;
  });

  const contours = el('div', { class: 'toggles', role: 'group', 'aria-label': t('controls.isochrones') });
  const isoBoxes = ISOCHRONE_CHOICES.map((minutes) => {
    const { input, label } = checkbox(t('isochrone.label', { minutes }), { iso: String(minutes) });
    label.title = t('isochrone.toggle', { minutes });
    input.addEventListener('change', () => app.dispatch({ type: 'iso', minutes }));
    contours.append(label);
    return input;
  });

  const range = el('input', { type: 'range', min: String(SCALE.min), max: String(SCALE.max), step: '5' });
  const scaleText = el('span');
  range.addEventListener('input', () => app.dispatch({ type: 'scale', value: Number(range.value) }));
  const scale = el('label', { class: 'field' }, [scaleText, range]);

  container.append(locateButton, invertButton, shareButton, modes, contours, scale);

  function sync(state) {
    invertButton.setAttribute('aria-pressed', String(state.direction === 'arrival'));
    for (const radio of modeRadios) radio.checked = radio.dataset.travel === travelChoice(state);
    for (const box of isoBoxes) box.checked = state.isochrones.includes(Number(box.dataset.iso));
    range.value = String(state.scale);
    scaleText.textContent = t('controls.scale', { minutes: state.scale });
  }
  app.subscribe(sync);
  sync(app.getState());
}
