// @vitest-environment jsdom
// Escape removes the destination only when there is one and nothing else handled the key.
import { describe, expect, it, vi } from 'vitest';
import { bindDismiss } from '../../src/ui/dismiss.js';

function setup(destination) {
  const app = { getState: () => ({ destination }), dispatch: vi.fn() };
  const off = bindDismiss(document, app);
  return { app, off };
}
const press = (key, target = document) => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
};

describe('bindDismiss', () => {
  it('Escape clears the destination', () => {
    const { app, off } = setup([41.6, -4.7]);
    press('Escape');
    expect(app.dispatch).toHaveBeenCalledWith({ type: 'destination', point: null });
    off();
  });

  it('does nothing without a destination, for other keys, or when already handled', () => {
    const none = setup(null);
    press('Escape');
    expect(none.app.dispatch).not.toHaveBeenCalled();
    none.off();
    const some = setup([41.6, -4.7]);
    press('Enter');
    document.addEventListener('keydown', (e) => e.preventDefault(), { once: true, capture: true });
    press('Escape');
    expect(some.app.dispatch).not.toHaveBeenCalled();
    some.off();
  });

  it('stops listening after off()', () => {
    const { app, off } = setup([41.6, -4.7]);
    off();
    press('Escape');
    expect(app.dispatch).not.toHaveBeenCalled();
  });
});
