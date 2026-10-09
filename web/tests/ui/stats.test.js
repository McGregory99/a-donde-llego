// @vitest-environment jsdom
// R8.1, R8.2, R8.4, R8.5: stats panel with stated definitions, feed validity and the expiry banner.
import { describe, expect, it } from 'vitest';
import { t } from '../../src/i18n.js';
import { formatDate, renderExpiryBanner, renderStats } from '../../src/ui/stats.js';

const stats = (overrides = {}) => ({
  built_on: '2026-10-07',
  feed: { expired: false, valid_from: '2026-10-07', valid_to: '2026-12-27' },
  headway: { typical_min: 24, best_min: 8, by_line: [] },
  lines: 58,
  reach: { origins: 1, percent_stops: 61.2, scope: 'boundary', threshold_min: 30 },
  stops: 566,
  ...overrides,
});
const panel = (value) => {
  const container = document.createElement('div');
  renderStats(container, value, t);
  return container;
};
const row = (container, key) => container.querySelector(`[data-stat="${key}"]`)?.textContent;

describe('formatDate', () => {
  it('writes ISO dates day first, as in Spain', () => {
    expect(formatDate('2026-10-07')).toBe('07/10/2026');
    expect(formatDate('2027-01-31')).toBe('31/01/2027');
  });
});

describe('renderStats', () => {
  it('shows reach, line headways, stops, lines and the feed validity from the build', () => {
    const container = panel(stats());
    expect(container.querySelector('h2').textContent).toBe(t('stats.title'));
    expect(row(container, 'reach')).toBe('61,2 %');
    expect(row(container, 'headway')).toBe('24 min');
    expect(row(container, 'bestHeadway')).toBe('8 min');
    expect(row(container, 'stops')).toBe('566');
    expect(row(container, 'lines')).toBe('58');
    expect(row(container, 'validity')).toBe(t('stats.validity', { from: '07/10/2026', to: '27/12/2026' }));
    expect(container.textContent).toContain(t('stats.builtOn', { date: '07/10/2026' }));
  });

  it('states what the reach percentage measures, from the city centre (R8.2)', () => {
    const container = panel(stats());
    expect(container.textContent).toContain(t('stats.reachDefinition.boundary', { minutes: 30 }));
    expect(container.textContent).toContain(t('stats.headwayDefinition'));
  });

  it('describes the served-area scope when the city has no boundary', () => {
    const container = panel(stats({ reach: { origins: 1, percent_stops: 80, scope: 'served', threshold_min: 45 } }));
    expect(container.textContent).toContain(t('stats.reachDefinition.served', { minutes: 45 }));
    expect(container.textContent).not.toContain(t('stats.reachDefinition.boundary', { minutes: 45 }));
    expect(row(container, 'reach')).toBe('80 %');
  });

  it('with walking on streets the headline is the share of street nodes, defined as such', () => {
    const container = panel(stats({ reach: { origins: 1, percent_stops: 51.9, percent_nodes: 30.8, scope: 'streets', threshold_min: 30 } }));
    expect(row(container, 'reach')).toBe('30,8 %');
    expect(container.querySelector('dt').textContent).toBe(t('stats.reachStreets', { minutes: 30 }));
    expect(container.textContent).toContain(t('stats.reachDefinition.streets', { minutes: 30 }));
    expect(t('stats.reachDefinition.streets', { minutes: 30 })).toMatch(/calles|cruces/);
  });

  it('the street scope needs its own figure: a streets stats.json without percent_nodes is unusable', () => {
    expect(panel(stats({ reach: { origins: 1, percent_stops: 51.9, scope: 'streets', threshold_min: 30 } })).hidden).toBe(true);
  });

  it('mentions averaging when several reference origins were used', () => {
    expect(panel(stats()).textContent).not.toContain(t('stats.reachOrigins', { count: 3 }));
    const many = panel(stats({ reach: { origins: 3, percent_stops: 50, scope: 'boundary', threshold_min: 30 } }));
    expect(many.textContent).toContain(t('stats.reachOrigins', { count: 3 }));
  });

  it('replaces previous content when rendered again', () => {
    const container = panel(stats());
    renderStats(container, stats({ stops: 10 }), t);
    expect(container.querySelectorAll('h2')).toHaveLength(1);
    expect(row(container, 'stops')).toBe('10');
  });
});

describe('renderStats with missing or malformed stats', () => {
  it('hides and empties the panel when there are no stats (the asset is optional)', () => {
    const container = panel(stats());
    renderStats(container, null, t);
    expect(container.hidden).toBe(true);
    expect(container.textContent).toBe('');
  });

  it.each([
    ['no reach', { reach: undefined }],
    ['non-numeric percentage', { reach: { origins: 1, percent_stops: '61', scope: 'boundary', threshold_min: 30 } }],
    ['no headway block', { headway: undefined }],
    ['legacy headway without the new fields', { headway: { overall_median_min: 52, by_line: [] } }],
    ['NaN headway', { headway: { typical_min: NaN, best_min: 8, by_line: [] } }],
    ['no feed', { feed: undefined }],
    ['feed without dates', { feed: { expired: false } }],
    ['unknown reach scope', { reach: { origins: 1, percent_stops: 61, scope: 'moon', threshold_min: 30 } }],
  ])('hides the panel instead of throwing: %s', (_name, overrides) => {
    const container = panel(stats());
    expect(() => renderStats(container, stats(overrides), t)).not.toThrow();
    expect(container.hidden).toBe(true);
    expect(container.textContent).toBe('');
  });

  it('shows the panel again once valid stats arrive', () => {
    const container = panel(null);
    expect(container.hidden).toBe(true);
    renderStats(container, stats(), t);
    expect(container.hidden).toBe(false);
    expect(row(container, 'stops')).toBe('566');
  });
});

describe('renderExpiryBanner', () => {
  const banner = (meta) => {
    const container = document.createElement('div');
    renderExpiryBanner(container, meta, t);
    return container;
  };

  it('shows a visible warning with the end date when the feed is expired', () => {
    const container = banner({ feed: { expired: true, valid_to: '2026-03-20' } });
    expect(container.hidden).toBe(false);
    expect(container.getAttribute('role')).toBe('alert');
    expect(container.textContent).toBe(t('stats.expired', { date: '20/03/2026' }));
  });

  it('stays hidden and empty for a valid feed', () => {
    const container = banner({ feed: { expired: false, valid_to: '2026-12-27' } });
    expect(container.hidden).toBe(true);
    expect(container.textContent).toBe('');
  });

  it('clears a previous warning', () => {
    const container = banner({ feed: { expired: true, valid_to: '2026-03-20' } });
    renderExpiryBanner(container, { feed: { expired: false, valid_to: '2026-12-27' } }, t);
    expect(container.hidden).toBe(true);
    expect(container.textContent).toBe('');
  });
});
