// @vitest-environment jsdom
// R4.5, R4.6: the legend explains the colour scale, the contours and the direction.
import { describe, expect, it } from 'vitest';
import { t } from '../../src/i18n.js';
import { legendModel, renderLegend } from '../../src/ui/legend.js';

const state = { direction: 'departure', scale: 45, isochrones: [15, 30], modes: ['road'] };

describe('legendModel', () => {
  it('states the direction (R4.6)', () => {
    expect(legendModel(state).captionKey).toBe('legend.departure');
    expect(legendModel({ ...state, direction: 'arrival' }).captionKey).toBe('legend.arrival');
  });

  it('says "on foot" when no transit mode is enabled', () => {
    expect(legendModel({ ...state, modes: [] }).captionKey).toBe('legend.departureWalk');
    expect(legendModel({ ...state, modes: [], direction: 'arrival' }).captionKey).toBe('legend.arrivalWalk');
    expect(t('legend.departureWalk')).not.toBe(t('legend.departure'));
  });

  it('ticks run from 0 to the scale maximum through the middle', () => {
    expect(legendModel(state).ticks).toEqual([0, 23, 45]);
    expect(legendModel({ ...state, scale: 30 }).ticks).toEqual([0, 15, 30]);
  });

  it('lists the contours currently shown', () => {
    expect(legendModel(state).contours).toEqual([15, 30]);
    expect(legendModel({ ...state, isochrones: [] }).contours).toEqual([]);
  });
});

describe('renderLegend', () => {
  it('writes the caption, the gradient bar, the ticks and the contour entries in Spanish', () => {
    const el = document.createElement('div');
    renderLegend(el, legendModel({ ...state, direction: 'arrival', isochrones: [30] }), t);
    expect(el.textContent).toContain(t('legend.arrival'));
    expect(el.textContent).toContain('45 min');
    expect(el.textContent).toContain('30 min');
    expect(el.textContent).toContain(t('legend.contours'));
    expect(el.querySelector('.legend-bar').style.background).toContain('linear-gradient');
  });

  it('omits the contour entry when none is shown', () => {
    const el = document.createElement('div');
    renderLegend(el, legendModel({ ...state, isochrones: [] }), t);
    expect(el.textContent).not.toContain(t('legend.contours'));
  });
});
