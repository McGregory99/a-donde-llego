// R7.3: Share copies the URL (or opens the native share sheet).
import { describe, expect, it, vi } from 'vitest';
import { cityDefaults, defaultState, parseState } from '../../src/state-url.js';
import { ShareError, buildShareUrl, shareLink } from '../../src/ui/share.js';

const config = { id: 'x', bbox: [-5, 41, -4, 42], center: [41.5, -4.5], modes: { w: { kind: 'walk' }, a: { kind: 'transit' } } };
const city = cityDefaults(config);

describe('buildShareUrl', () => {
  it('is the page address plus the serialised state and restores the same state', () => {
    const state = { ...defaultState(city), origin: [41.6, -4.6], direction: 'arrival', scale: 30 };
    const url = new URL(buildShareUrl(state, { origin: 'https://example.org', pathname: '/map/' }));
    expect(url.origin + url.pathname).toBe('https://example.org/map/');
    expect(parseState(url.search, city)).toEqual({ state, ignored: [] });
  });
});

describe('shareLink', () => {
  const url = 'https://example.org/?c=x';

  it('uses the native share sheet when there is one', async () => {
    const nav = { share: vi.fn(async () => {}), clipboard: { writeText: vi.fn() } };
    expect(await shareLink(nav, url, 'Title')).toBe('shared');
    expect(nav.share).toHaveBeenCalledWith({ title: 'Title', url });
    expect(nav.clipboard.writeText).not.toHaveBeenCalled();
  });

  it('a cancelled share sheet copies nothing', async () => {
    const nav = {
      share: vi.fn(async () => {
        throw Object.assign(new Error('x'), { name: 'AbortError' });
      }),
      clipboard: { writeText: vi.fn() },
    };
    expect(await shareLink(nav, url, 'T')).toBe('cancelled');
    expect(nav.clipboard.writeText).not.toHaveBeenCalled();
  });

  it('copies to the clipboard without a share sheet or when it fails', async () => {
    const copy = { writeText: vi.fn(async () => {}) };
    expect(await shareLink({ clipboard: copy }, url, 'T')).toBe('copied');
    expect(copy.writeText).toHaveBeenCalledWith(url);
    const broken = { share: vi.fn(async () => { throw new Error('nope'); }), clipboard: copy };
    expect(await shareLink(broken, url, 'T')).toBe('copied');
  });

  it('raises a typed error when nothing worked', async () => {
    const error = await shareLink({ clipboard: { writeText: async () => { throw new Error('denied'); } } }, url, 'T').catch((e) => e);
    expect(error).toBeInstanceOf(ShareError);
    expect(error.key).toBe('errors.shareFailed');
    expect((await shareLink({}, url, 'T').catch((e) => e)).key).toBe('errors.shareFailed');
  });
});
