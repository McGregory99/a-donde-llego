// @vitest-environment jsdom
// Control bar: direction, modes, contours, scale, my position, share and search wired to the app.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { modeLabel, t } from '../../src/i18n.js';
import { cityDefaults, defaultState } from '../../src/state-url.js';
import { createControls } from '../../src/ui/controls.js';
import { LocateError } from '../../src/ui/geolocate.js';
import { ShareError } from '../../src/ui/share.js';
import { reduce } from '../../src/ui/state.js';

const config = {
  id: 'x',
  bbox: [-5, 41, -4, 42],
  center: [41.5, -4.5],
  modes: { walk: { kind: 'walk' }, rail: { kind: 'transit', enabled_default: true }, road: { kind: 'transit', enabled_default: true } },
};
const city = cityDefaults(config);
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
let container;

function setup(deps = {}) {
  container = document.createElement('div');
  document.body.replaceChildren(container);
  let state = defaultState(city);
  const listeners = new Set();
  const app = {
    city,
    getState: () => state,
    dispatch: vi.fn((action) => {
      state = reduce(state, action, city);
      listeners.forEach((l) => l(state, {}));
    }),
    subscribe: (l) => (listeners.add(l), () => listeners.delete(l)),
    notify: vi.fn(),
    inCity: () => true,
    map: { reveal: vi.fn() },
  };
  const parts = {
    geocoder: { suggest: vi.fn(), search: vi.fn(), reverse: vi.fn() },
    locate: vi.fn(),
    share: vi.fn(),
    shareUrl: vi.fn(() => 'https://example.org/?c=x'),
    t,
    ...deps,
  };
  createControls(container, app, parts);
  return { app, parts, $: (selector) => container.querySelector(selector) };
}

beforeEach(() => vi.restoreAllMocks());

describe('direction (R4.6)', () => {
  it('Invertir toggles departure/arrival and reflects it as pressed', () => {
    const { app, $ } = setup();
    const button = $('[data-action="invert"]');
    expect(button.textContent).toBe(t('controls.invert'));
    expect(button.getAttribute('aria-pressed')).toBe('false');
    button.click();
    expect(app.dispatch).toHaveBeenCalledWith({ type: 'invert' });
    expect(button.getAttribute('aria-pressed')).toBe('true');
  });
});

describe('modes (R4.7)', () => {
  it('has one labelled checkbox per transit mode of the city, checked by default', () => {
    const { $ } = setup();
    const boxes = [...container.querySelectorAll('[data-mode]')];
    expect(boxes.map((b) => b.dataset.mode).sort()).toEqual(['rail', 'road']);
    expect(boxes.every((b) => b.checked)).toBe(true);
    expect(container.textContent).toContain(modeLabel('rail'));
    expect($('[data-mode="walk"]')).toBeNull();
  });

  it('toggling dispatches and the checkbox follows the state', () => {
    const { app, $ } = setup();
    const box = $('[data-mode="road"]');
    box.checked = false;
    box.dispatchEvent(new Event('change'));
    expect(app.dispatch).toHaveBeenCalledWith({ type: 'mode', id: 'road' });
    expect(app.getState().modes).toEqual(['rail']);
  });
});

describe('isochrones (R4.4)', () => {
  it('offers 15, 30, 45, 60 with 15 and 30 on', () => {
    setup();
    const boxes = [...container.querySelectorAll('[data-iso]')];
    expect(boxes.map((b) => [Number(b.dataset.iso), b.checked])).toEqual([[15, true], [30, true], [45, false], [60, false]]);
  });

  it('enabling 45 dispatches the toggle', () => {
    const { app, $ } = setup();
    const box = $('[data-iso="45"]');
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    expect(app.dispatch).toHaveBeenCalledWith({ type: 'iso', minutes: 45 });
    expect(app.getState().isochrones).toEqual([15, 30, 45]);
  });
});

describe('scale slider (R4.3)', () => {
  it('shows the current maximum and dispatches while sliding', () => {
    const { app, $ } = setup();
    const range = $('input[type="range"]');
    expect(range.value).toBe('45');
    expect(container.textContent).toContain(t('controls.scale', { minutes: 45 }));
    range.value = '30';
    range.dispatchEvent(new Event('input'));
    expect(app.dispatch).toHaveBeenCalledWith({ type: 'scale', value: 30 });
    expect(container.textContent).toContain(t('controls.scale', { minutes: 30 }));
  });
});

describe('my position (R6.5)', () => {
  it('moves the departure to the located point and reveals it', async () => {
    const { app, parts, $ } = setup({ locate: vi.fn(async () => [41.6, -4.6]) });
    $('[data-action="locate"]').click();
    await tick();
    expect(parts.locate).toHaveBeenCalled();
    expect(app.dispatch).toHaveBeenCalledWith({ type: 'origin', point: [41.6, -4.6] });
    expect(app.map.reveal).toHaveBeenCalledWith([41.6, -4.6]);
  });

  it('on failure shows the message and leaves the departure unchanged', async () => {
    const { app, $ } = setup({ locate: vi.fn(async () => { throw new LocateError('errors.geolocationDenied'); }) });
    const before = app.getState().origin;
    $('[data-action="locate"]').click();
    await tick();
    expect(app.notify).toHaveBeenCalledWith(t('errors.geolocationDenied'));
    expect(app.dispatch).not.toHaveBeenCalled();
    expect(app.getState().origin).toEqual(before);
  });
});

describe('share (R7.3)', () => {
  it('shares the current URL and confirms when copied', async () => {
    const { app, parts, $ } = setup({ share: vi.fn(async () => 'copied') });
    $('[data-action="share"]').click();
    await tick();
    expect(parts.shareUrl).toHaveBeenCalledWith(app.getState());
    expect(parts.share).toHaveBeenCalledWith('https://example.org/?c=x', t('app.title'));
    expect(app.notify).toHaveBeenCalledWith(t('controls.shareCopied'));
  });

  it('reports a failure without throwing', async () => {
    const { app, $ } = setup({ share: vi.fn(async () => { throw new ShareError('errors.shareFailed'); }) });
    $('[data-action="share"]').click();
    await tick();
    expect(app.notify).toHaveBeenCalledWith(t('errors.shareFailed'));
  });
});

describe('search', () => {
  it('choosing a result moves the departure and reveals it (R6.3)', async () => {
    const geocoder = { suggest: vi.fn(async () => ({ results: [{ label: 'A', lat: 41.7, lon: -4.7 }], outside: 0 })), search: vi.fn() };
    const { app, $ } = setup({ geocoder });
    const input = $('input[type="search"]');
    input.value = 'Calle';
    input.dispatchEvent(new Event('input'));
    await tick();
    container.querySelector('.search-results button').click();
    expect(app.dispatch).toHaveBeenCalledWith({ type: 'origin', point: [41.7, -4.7] });
    expect(app.map.reveal).toHaveBeenCalledWith([41.7, -4.7]);
  });

  it('a geocoder failure is shown as a message and the map stays usable (R6.6)', async () => {
    const geocoder = { suggest: vi.fn(async () => { throw Object.assign(new Error('x'), { key: 'errors.geocoder' }); }), search: vi.fn() };
    const { app, $ } = setup({ geocoder });
    const input = $('input[type="search"]');
    input.value = 'Calle';
    input.dispatchEvent(new Event('input'));
    await tick();
    expect(app.notify).toHaveBeenCalledWith(t('errors.geocoder'));
  });
});
