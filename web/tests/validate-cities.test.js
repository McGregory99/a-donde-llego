import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCities, DEFAULT_CITIES_DIR } from '../../scripts/validate-cities.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const VALID = {
  id: 'foo',
  name: 'Foo',
  bbox: [-1, 40, 1, 41],
  center: [40.5, 0],
  locale: 'es',
  geocoder: { provider: 'photon' },
  gtfs: { sources: ['http://example.test/f.zip'], license: 'L', attribution: 'A' },
  modes: { walk: { kind: 'walk' }, bus: { kind: 'transit', route_types: [3] } },
  window: { start: '07:00', end: '20:00' },
};

function dirWith(city) {
  const dir = mkdtempSync(join(tmpdir(), 'cities-'));
  copyFileSync(join(REPO, 'cities', 'schema.json'), join(dir, 'schema.json'));
  if (city) writeFileSync(join(dir, 'foo.json'), JSON.stringify(city));
  return dir;
}

describe('validateCities', () => {
  it('accepts the shipped city configs', () => {
    expect(validateCities(join(REPO, 'cities'))).toEqual([]);
  });

  it('defaults to the repo cities dir regardless of cwd', () => {
    expect(DEFAULT_CITIES_DIR).toBe(join(REPO, 'cities'));
    const cwd = process.cwd();
    process.chdir(tmpdir());
    try {
      expect(validateCities()).toEqual([]);
    } finally {
      process.chdir(cwd);
    }
  });

  it('accepts a new valid city file', () => {
    expect(validateCities(dirWith(VALID))).toEqual([]);
  });

  it('names file and field for a missing gtfs', () => {
    const { gtfs, ...rest } = VALID;
    const errors = validateCities(dirWith(rest));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('foo.json');
    expect(errors[0]).toContain('gtfs');
  });

  it('fails when the id does not match the file name', () => {
    const errors = validateCities(dirWith({ ...VALID, id: 'other' }));
    expect(errors[0]).toMatch(/foo\.json.*id/);
  });
});
