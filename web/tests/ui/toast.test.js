// @vitest-environment jsdom
// Non-blocking messages (R6.6): shown in a live region and dismissed on their own.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createToast } from '../../src/ui/toast.js';

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '<div id="t" hidden></div>';
});
afterEach(() => vi.useRealTimers());

describe('createToast', () => {
  it('shows the message and hides it after the delay', () => {
    const element = document.getElementById('t');
    const toast = createToast(element, 1000);
    toast('Hola');
    expect(element.textContent).toBe('Hola');
    expect(element.hidden).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(element.hidden).toBe(true);
  });

  it('a newer message replaces the old one and restarts the timer', () => {
    const element = document.getElementById('t');
    const toast = createToast(element, 1000);
    toast('uno');
    vi.advanceTimersByTime(800);
    toast('dos');
    vi.advanceTimersByTime(800);
    expect(element.hidden).toBe(false);
    expect(element.textContent).toBe('dos');
    vi.advanceTimersByTime(200);
    expect(element.hidden).toBe(true);
  });
});
