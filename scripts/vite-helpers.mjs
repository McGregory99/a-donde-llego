// Helpers for vite.config.js, kept here so they can be unit-tested without a dev server.
import { rmSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';

/**
 * Absolute file for `pathname` (a URL path under /data) inside `root`, or null when the path escapes it.
 * Compares with path.relative, so a sibling such as `<root>-private` never passes a plain prefix check.
 */
export function resolveDataFile(root, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const file = resolve(join(root, decoded));
  const inside = relative(root, file);
  return inside && !inside.startsWith('..') && !isAbsolute(inside) ? file : null;
}

/** Deletes previously built hashed assets (`<outDir>/assets`) without touching `<outDir>/data`. */
export function cleanStaleAssets(outDir) {
  rmSync(join(outDir, 'assets'), { recursive: true, force: true });
}
