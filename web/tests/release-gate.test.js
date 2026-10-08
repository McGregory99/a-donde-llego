// R2.3 / task 14.3: the deploy must fail when any city feed is expired or a city has no built data.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkRelease } from '../../scripts/release-gate.mjs';

const TODAY = '2026-10-08';

function site(cities, metas) {
  const root = mkdtempSync(join(tmpdir(), 'adl-gate-'));
  const citiesDir = join(root, 'cities');
  const dataDir = join(root, 'data');
  mkdirSync(citiesDir);
  writeFileSync(join(citiesDir, 'schema.json'), '{}');
  for (const id of cities) writeFileSync(join(citiesDir, `${id}.json`), JSON.stringify({ id }));
  for (const [id, meta] of Object.entries(metas)) {
    mkdirSync(join(dataDir, id), { recursive: true });
    writeFileSync(join(dataDir, id, 'meta.json'), typeof meta === 'string' ? meta : JSON.stringify(meta));
  }
  return { citiesDir, dataDir };
}
const feed = (valid_to, expired = false) => ({ feed: { valid_from: '2026-01-01', valid_to, expired } });
const run = (cities, metas) => checkRelease({ ...site(cities, metas), today: TODAY });

describe('checkRelease', () => {
  it('passes when every city has data with a feed that is still valid', () => {
    expect(run(['a', 'b'], { a: feed('2026-12-27'), b: feed(TODAY) })).toEqual([]);
  });

  it('fails for a feed flagged expired at build time', () => {
    const problems = run(['a'], { a: feed('2026-12-27', true) });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/a.*expired/);
  });

  it('fails for a feed that ended before today even if the build did not flag it', () => {
    const problems = run(['a', 'b'], { a: feed('2026-10-07'), b: feed('2026-12-27') });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/a.*2026-10-07/);
  });

  it('fails for a city whose data was never built', () => {
    const problems = run(['a', 'b'], { a: feed('2026-12-27') });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/b.*meta\.json/);
  });

  it('fails for unreadable or incomplete meta.json', () => {
    expect(run(['a'], { a: '{not json' })[0]).toMatch(/a.*meta\.json/);
    expect(run(['a'], { a: { feed: {} } })[0]).toMatch(/a.*valid_to/);
  });
});
