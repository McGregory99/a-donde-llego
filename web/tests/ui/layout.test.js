// @vitest-environment jsdom
// Full-screen layout: the map is the page; header, controls, itinerary and the stats card float over it.
import { beforeEach, describe, expect, it } from 'vitest';
import { t } from '../../src/i18n.js';
import { buildLayout } from '../../src/ui/layout.js';
import { createStatsCard } from '../../src/ui/stats-card.js';

describe('buildLayout', () => {
  let root;
  let layout;
  beforeEach(() => {
    root = document.createElement('div');
    layout = buildLayout(root, t);
  });

  it('puts the map stage first and floats everything else in overlays over it', () => {
    expect(root.firstElementChild).toBe(layout.stage);
    expect(layout.stage.contains(layout.canvas)).toBe(true);
    const left = root.querySelector('.overlay-left');
    for (const part of [layout.banner, layout.controls, layout.panel]) expect(left.contains(part)).toBe(true);
    expect(left.querySelector('header h1')).not.toBeNull();
  });

  it('keeps the stats inside a card with a toggle, outside the map stage', () => {
    expect(layout.statsCard.contains(layout.stats)).toBe(true);
    expect(layout.statsCard.contains(layout.statsToggle)).toBe(true);
    expect(layout.stage.contains(layout.statsCard)).toBe(false);
    expect(layout.statsToggle.getAttribute('aria-controls')).toBe(layout.stats.id);
  });
});

describe('createStatsCard', () => {
  const setup = (narrow) => {
    const layout = buildLayout(document.createElement('div'), t);
    const card = createStatsCard(layout, t, { narrow });
    return { layout, card };
  };

  it('starts expanded on wide screens and collapsed on narrow ones', () => {
    const wide = setup(false).layout;
    expect(wide.statsCard.classList.contains('collapsed')).toBe(false);
    expect(wide.statsToggle.getAttribute('aria-expanded')).toBe('true');
    expect(wide.statsToggle.textContent).toBe(t('stats.hide'));
    const narrow = setup(true).layout;
    expect(narrow.statsCard.classList.contains('collapsed')).toBe(true);
    expect(narrow.statsToggle.getAttribute('aria-expanded')).toBe('false');
    expect(narrow.statsToggle.textContent).toBe(t('stats.show'));
  });

  it('the toggle collapses and expands the card', () => {
    const { layout } = setup(false);
    layout.statsToggle.click();
    expect(layout.statsCard.classList.contains('collapsed')).toBe(true);
    expect(layout.statsToggle.getAttribute('aria-expanded')).toBe('false');
    layout.statsToggle.click();
    expect(layout.statsCard.classList.contains('collapsed')).toBe(false);
    expect(layout.statsToggle.textContent).toBe(t('stats.hide'));
  });
});
