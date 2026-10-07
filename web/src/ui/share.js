// Share control (R7.3): the native share sheet when available, else the clipboard.
import { serializeState } from '../state-url.js';

/** Failure with `key` = i18n key for the user-visible message. */
export class ShareError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ShareError';
    this.key = 'errors.shareFailed';
  }
}

/** Absolute link restoring `state` on the page at `where` ({origin, pathname}). */
export function buildShareUrl(state, where) {
  return `${where.origin}${where.pathname}?${serializeState(state)}`;
}

/** Shares `url`; resolves 'shared' | 'cancelled' | 'copied', or rejects with ShareError. */
export async function shareLink(nav, url, title) {
  if (nav?.share) {
    try {
      await nav.share({ title, url });
      return 'shared';
    } catch (error) {
      if (error?.name === 'AbortError') return 'cancelled';
      // Any other failure: fall back to copying.
    }
  }
  try {
    await nav.clipboard.writeText(url);
    return 'copied';
  } catch (error) {
    throw new ShareError(`share: ${error?.message ?? 'no clipboard'}`);
  }
}
