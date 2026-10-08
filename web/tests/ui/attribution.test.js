// @vitest-environment jsdom
// R9.1, R9.3, R9.4, R9.5: attribution is data-driven from the city config plus global credits.
import { describe, expect, it } from 'vitest';
import { t } from '../../src/i18n.js';
import { REFERENCE_PROJECT, attributionEntries, renderAttributionBar, renderAttributionPage } from '../../src/ui/attribution.js';

const config = {
  id: 'x',
  attribution: [{ name: 'Feed Co', url: 'https://feed.example/data', license: 'CC BY 3.0 ES', text: 'Fuente: Feed Co' }],
  geocoder: { provider: 'photon', reverse: { provider: 'nominatim' } },
};
const meta = { built_on: '2026-10-07', feed: { valid_from: '2026-10-07', valid_to: '2026-12-27', source: 'https://feed.example/gtfs' } };
const names = (entries) => entries.map((entry) => entry.name);

describe('attributionEntries', () => {
  it('lists the city data sources first, then OSM, the geocoders and the reference project', () => {
    expect(names(attributionEntries(config, t))).toEqual([
      'Feed Co',
      'OpenStreetMap',
      'Photon (Komoot)',
      'Nominatim (OpenStreetMap)',
      REFERENCE_PROJECT.name,
    ]);
  });

  it('credits the licenses: city feed, ODbL for OSM and MIT for the reference project', () => {
    const byName = Object.fromEntries(attributionEntries(config, t).map((entry) => [entry.name, entry]));
    expect(byName['Feed Co'].license).toBe('CC BY 3.0 ES');
    expect(byName.OpenStreetMap.license).toBe('ODbL');
    expect(byName.OpenStreetMap.text).toBe(t('attribution.osm'));
    expect(byName[REFERENCE_PROJECT.name].license).toBe('MIT');
    expect(byName[REFERENCE_PROJECT.name].text).toContain('Camille Roux');
  });

  it('follows the configured geocoder providers and skips unknown ones', () => {
    const other = { ...config, geocoder: { provider: 'nominatim' } };
    expect(names(attributionEntries(other, t))).toContain('Nominatim (OpenStreetMap)');
    expect(names(attributionEntries(other, t))).not.toContain('Photon (Komoot)');
    expect(names(attributionEntries({ ...config, geocoder: { provider: 'mystery' } }, t))).not.toContain('mystery');
  });

  it('shows a new city source with no code change and tolerates a config without attribution', () => {
    const next = { ...config, attribution: [{ name: 'Other Feed', license: 'CC0' }] };
    expect(names(attributionEntries(next, t))[0]).toBe('Other Feed');
    expect(names(attributionEntries({ id: 'y' }, t))[0]).toBe('OpenStreetMap');
  });

  it('pins the reference project to the vendored upstream commit', () => {
    expect(REFERENCE_PROJECT.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(REFERENCE_PROJECT.url).toContain('github.com/camilleroux/montpellier-temps-transport');
  });
});

describe('renderAttributionBar', () => {
  it('shows the short credits with a link to the about page', () => {
    const container = document.createElement('div');
    renderAttributionBar(container, attributionEntries(config, t), 'acerca.html?c=x', t);
    expect(container.textContent).toContain('Fuente: Feed Co');
    expect(container.textContent).toContain('© OpenStreetMap contributors');
    const link = container.querySelector('a[href="acerca.html?c=x"]');
    expect(link.textContent).toBe(t('attribution.about'));
  });

  it('does not repeat credits that have no short form (geocoders, reference project)', () => {
    const container = document.createElement('div');
    renderAttributionBar(container, attributionEntries(config, t), 'acerca.html', t);
    expect(container.textContent).not.toContain('Photon');
    expect(container.textContent).not.toContain(REFERENCE_PROJECT.name);
  });
});

describe('renderAttributionPage', () => {
  const page = () => {
    const container = document.createElement('div');
    renderAttributionPage(container, { entries: attributionEntries(config, t), meta, backHref: './?c=x' }, t);
    return container;
  };

  it('lists every entry with its license and an external link', () => {
    const items = [...page().querySelectorAll('li.credit')];
    expect(items).toHaveLength(5);
    expect(items[0].textContent).toContain('Feed Co');
    expect(items[0].textContent).toContain('CC BY 3.0 ES');
    const link = items[0].querySelector('a');
    expect(link.getAttribute('href')).toBe('https://feed.example/data');
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('states the feed validity range and the pinned reference commit', () => {
    const text = page().textContent;
    expect(text).toContain(t('attribution.feedDates', { from: '07/10/2026', to: '27/12/2026' }));
    expect(text).toContain(REFERENCE_PROJECT.sha);
  });

  it('links back to the map', () => {
    expect(page().querySelector('a[href="./?c=x"]').textContent).toBe(t('attribution.back'));
  });

  it('works without feed metadata', () => {
    const container = document.createElement('div');
    renderAttributionPage(container, { entries: attributionEntries(config, t), meta: null, backHref: './' }, t);
    expect(container.textContent).not.toContain('undefined');
    expect(container.querySelectorAll('li.credit')).toHaveLength(5);
  });
});
