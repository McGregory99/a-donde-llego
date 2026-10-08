// Control bar wired to the app: search, my position, invert, share, modes, contours and scale.
import { modeLabel } from '../i18n.js';
import { ISOCHRONE_CHOICES, SCALE } from '../state-url.js';
import { createSearch } from './search.js';

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

  const modes = el('div', { class: 'toggles', role: 'group', 'aria-label': t('controls.modes') });
  const modeBoxes = app.city.modes.map((id) => {
    const { input, label } = checkbox(modeLabel(id, t), { mode: id });
    input.addEventListener('change', () => app.dispatch({ type: 'mode', id }));
    modes.append(label);
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
    for (const box of modeBoxes) box.checked = state.modes.includes(box.dataset.mode);
    for (const box of isoBoxes) box.checked = state.isochrones.includes(Number(box.dataset.iso));
    range.value = String(state.scale);
    scaleText.textContent = t('controls.scale', { minutes: state.scale });
  }
  app.subscribe(sync);
  sync(app.getState());
}
