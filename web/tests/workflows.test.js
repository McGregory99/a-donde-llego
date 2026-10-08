// R2.3 / task 14.2-14.3: invariants of the deploy workflow that must not regress silently.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const deploy = read('.github/workflows/deploy.yml');

describe('deploy workflow', () => {
  it('runs on push to main, weekly and on demand', () => {
    expect(deploy).toMatch(/push:\s*\n\s*branches: \[main\]/);
    expect(deploy).toMatch(/schedule:\s*\n\s*- cron: ".+"/);
    expect(deploy).toContain('workflow_dispatch:');
  });

  it('never tolerates expired feeds or skips OSM data', () => {
    expect(deploy).not.toContain('--allow-expired');
    expect(deploy).not.toContain('--skip-osm');
  });

  it('builds every city from cities/ except the schema, with the locked environment', () => {
    expect(deploy).toContain('uv sync --locked');
    expect(deploy).toMatch(/cities\/\*\.json/);
    expect(deploy).toContain('schema');
    expect(deploy).toContain('python -m adl.build');
  });

  it('runs the release gate before the site is built and uploaded', () => {
    const gate = deploy.indexOf('scripts/release-gate.mjs');
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(deploy.indexOf('vite build'));
    expect(deploy.indexOf('vite build')).toBeLessThan(deploy.indexOf('actions/upload-pages-artifact'));
  });

  it('builds the site for the Pages base path', () => {
    expect(deploy).toMatch(/ADL_BASE: \/a-donde-llego\//);
  });

  it('deploys with the Pages actions, minimal permissions and one concurrent run', () => {
    expect(deploy).toMatch(/permissions:\s*\n\s*contents: read\s*\n\s*pages: write\s*\n\s*id-token: write/);
    expect(deploy).toMatch(/concurrency:\s*\n\s*group: pages/);
    expect(deploy).toContain('actions/deploy-pages@v4');
    expect(deploy).toContain('actions/upload-pages-artifact@v3');
    expect(deploy).toMatch(/environment:\s*\n\s*name: github-pages/);
  });

  it('pins every action to a major version', () => {
    const uses = [...deploy.matchAll(/uses: (\S+)/g)].map((m) => m[1]);
    expect(uses.length).toBeGreaterThan(4);
    for (const action of uses) expect(action).toMatch(/@v\d+$/);
  });
});
