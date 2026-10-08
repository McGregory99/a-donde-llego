// Dev/build helpers used by vite.config.js: data path containment and stale asset cleanup.
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cleanStaleAssets, resolveBase, resolveDataFile } from '../../scripts/vite-helpers.mjs';

const root = resolve('/srv/dist/data');

describe('resolveDataFile', () => {
  it('maps a request path to a file under the data root', () => {
    expect(resolveDataFile(root, '/valladolid/meta.json')).toBe(join(root, 'valladolid', 'meta.json'));
  });

  it('rejects traversal out of the root', () => {
    expect(resolveDataFile(root, '/../secret.json')).toBeNull();
    expect(resolveDataFile(root, '/valladolid/../../other.json')).toBeNull();
  });

  it('rejects a sibling directory that merely shares the root as a name prefix', () => {
    expect(resolveDataFile(root, '/../data-private/x.json')).toBeNull();
  });

  it('rejects encoded traversal and malformed escapes', () => {
    expect(resolveDataFile(root, '/%2e%2e/data-private/x.json')).toBeNull();
    expect(resolveDataFile(root, '/%E0%A4%A.json')).toBeNull();
  });
});

describe('cleanStaleAssets', () => {
  it('removes hashed assets but keeps the pipeline data beside the site', () => {
    const out = mkdtempSync(join(tmpdir(), 'adl-dist-'));
    mkdirSync(join(out, 'assets'));
    mkdirSync(join(out, 'data', 'x'), { recursive: true });
    writeFileSync(join(out, 'assets', 'index-OLDHASH.js'), '');
    writeFileSync(join(out, 'data', 'x', 'meta.json'), '{}');
    cleanStaleAssets(out);
    expect(existsSync(join(out, 'assets'))).toBe(false);
    expect(existsSync(join(out, 'data', 'x', 'meta.json'))).toBe(true);
  });

  it('is a no-op when there is nothing to clean', () => {
    const out = mkdtempSync(join(tmpdir(), 'adl-dist-'));
    expect(() => cleanStaleAssets(out)).not.toThrow();
  });
});

describe('resolveBase', () => {
  it('defaults to the site root', () => {
    expect(resolveBase({})).toBe('/');
  });

  it('normalises the configured base to /segment/ (workflow passes it as an env variable)', () => {
    expect(resolveBase({ ADL_BASE: '/a-donde-llego/' })).toBe('/a-donde-llego/');
    expect(resolveBase({ ADL_BASE: 'a-donde-llego' })).toBe('/a-donde-llego/');
    expect(resolveBase({ ADL_BASE: '/x' })).toBe('/x/');
    expect(resolveBase({ ADL_BASE: '' })).toBe('/');
  });
});

describe('vite.config.js', () => {
  it('targets browsers with top-level await, which acerca.js uses', async () => {
    const config = (await import('../../vite.config.js')).default;
    expect(config.build.target).toBe('es2022');
  });
});
