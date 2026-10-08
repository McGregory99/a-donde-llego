// @vitest-environment jsdom
// Wiring of the "Acerca de" page (R9.1, R9.3, R9.5): city choice, base-relative back link, optional feed dates.
import { describe, expect, it, vi } from 'vitest';
import { t } from '../../src/i18n.js';
import { mountAbout } from '../../src/ui/about-page.js';

const cities = [
  { id: 'alfa', name: 'Alfa', attribution: [{ name: 'Alfa Transit', license: 'CC0', text: 'Fuente: Alfa' }], geocoder: { provider: 'photon' } },
  { id: 'beta', name: 'Beta', attribution: [{ name: 'Beta Transit', license: 'MIT', text: 'Fuente: Beta' }], geocoder: { provider: 'photon' } },
];
const meta = { feed: { valid_from: '2026-10-07', valid_to: '2026-12-27' }, built_on: '2026-10-07' };

const mount = async (search, load) => {
  const root = document.createElement('main');
  await mountAbout(root, { cities, search, base: '/a-donde-llego/', load, t });
  return root;
};

describe('mountAbout', () => {
  it('shows the credits of the city named by ?c= and loads only its meta under the base', async () => {
    const load = vi.fn(async () => ({ meta }));
    const root = await mount('?c=beta', load);
    expect(load).toHaveBeenCalledWith('beta', ['meta'], { base: '/a-donde-llego/data/' });
    expect(root.textContent).toContain('Beta Transit');
    expect(root.textContent).not.toContain('Alfa Transit');
    expect(root.textContent).toContain(t('attribution.feedDates', { from: '07/10/2026', to: '27/12/2026' }));
    expect(document.title).toBe(`${t('attribution.title')} · ${t('app.title')}`);
  });

  it('links back to the map under the base, keeping the city', async () => {
    const root = await mount('?c=beta', async () => ({ meta }));
    expect(root.querySelector(`a[href="/a-donde-llego/?c=beta"]`).textContent).toBe(t('attribution.back'));
  });

  it('falls back to the first city and still renders when meta.json cannot be loaded', async () => {
    const root = await mount('?c=nowhere', async () => { throw new Error('404'); });
    expect(root.textContent).toContain('Alfa Transit');
    expect(root.textContent).not.toContain(t('attribution.feedDates', { from: '07/10/2026', to: '27/12/2026' }));
    expect(root.querySelector('a[href="/a-donde-llego/?c=alfa"]')).not.toBeNull();
  });
});
