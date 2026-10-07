// @vitest-environment jsdom
// R6.1-R6.4, R6.6: address search with suggestions, outside/no-result notes, non-blocking errors.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../../src/i18n.js';
import { GeocoderError } from '../../src/geocoder/index.js';
import { createSearch } from '../../src/ui/search.js';

const place = (label, lat = 41.65, lon = -4.72) => ({ label, lat, lon });
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
let container;

beforeEach(() => {
  container = document.createElement('div');
  document.body.replaceChildren(container);
});

function setup(geocoder) {
  const onSelect = vi.fn();
  const onError = vi.fn();
  const search = createSearch(container, { geocoder, t, onSelect, onError });
  const input = container.querySelector('input');
  const type = async (value) => {
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await tick();
  };
  return { search, input, onSelect, onError, type };
}

describe('createSearch', () => {
  it('labels the input from translations', () => {
    setup({ suggest: vi.fn(), search: vi.fn() });
    const input = container.querySelector('input');
    expect(input.placeholder).toBe(t('controls.searchPlaceholder'));
    expect(input.getAttribute('aria-label')).toBe(t('controls.search'));
  });

  it('lists suggestions from suggest() as buttons', async () => {
    const geocoder = { suggest: vi.fn(async () => ({ results: [place('A'), place('B')], outside: 0 })), search: vi.fn() };
    const { type } = setup(geocoder);
    await type('Calle');
    expect(geocoder.suggest).toHaveBeenCalledWith('Calle');
    expect([...container.querySelectorAll('.search-results button')].map((b) => b.textContent)).toEqual(['A', 'B']);
  });

  it('selecting a suggestion reports it, fills the input and closes the list (R6.3)', async () => {
    const geocoder = { suggest: vi.fn(async () => ({ results: [place('A')], outside: 0 })), search: vi.fn() };
    const { type, onSelect, input } = setup(geocoder);
    await type('Calle');
    container.querySelector('.search-results button').click();
    expect(onSelect).toHaveBeenCalledWith(place('A'));
    expect(input.value).toBe('A');
    expect(container.querySelector('.search-results').hidden).toBe(true);
  });

  it('notes hidden outside results and an empty answer (R6.4)', async () => {
    const outside = { suggest: vi.fn(async () => ({ results: [place('A')], outside: 2 })), search: vi.fn() };
    const first = setup(outside);
    await first.type('Calle');
    expect(container.textContent).toContain(t('controls.resultsOutside', { count: 2 }));
    const empty = setup({ suggest: vi.fn(async () => ({ results: [], outside: 0 })), search: vi.fn() });
    await empty.type('zzz');
    expect(container.textContent).toContain(t('controls.noResults'));
  });

  it('ignores a superseded (null) answer', async () => {
    const { type } = setup({ suggest: vi.fn(async () => null), search: vi.fn() });
    await type('Calle');
    expect(container.querySelector('.search-results').hidden).toBe(true);
  });

  it('shortens nothing below the minimum: short input clears the list without calling the geocoder', async () => {
    const geocoder = { suggest: vi.fn(async () => ({ results: [place('A')], outside: 0 })), search: vi.fn() };
    const { type } = setup(geocoder);
    await type('Ca');
    expect(geocoder.suggest).not.toHaveBeenCalled();
  });

  it('reports geocoder failures by key without throwing (R6.6)', async () => {
    const failing = { suggest: vi.fn(async () => { throw new GeocoderError('errors.geocoderRateLimit'); }), search: vi.fn() };
    const { type, onError } = setup(failing);
    await type('Calle');
    expect(onError).toHaveBeenCalledWith('errors.geocoderRateLimit');
  });

  it('submitting picks the first result of a full search', async () => {
    const geocoder = { suggest: vi.fn(), search: vi.fn(async () => ({ results: [place('First'), place('Second')], outside: 0 })) };
    const { input, onSelect } = setup(geocoder);
    input.value = 'Plaza Mayor';
    container.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
    await tick();
    expect(geocoder.search).toHaveBeenCalledWith('Plaza Mayor');
    expect(onSelect).toHaveBeenCalledWith(place('First'));
  });
});
