// R9.2: LICENSE and NOTICE exist and stay consistent with the in-app credits and the city configs.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REFERENCE_PROJECT } from '../src/ui/attribution.js';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const cityConfigs = () =>
  readdirSync(new URL('../../cities', import.meta.url))
    .filter((file) => file.endsWith('.json') && file !== 'schema.json')
    .map((file) => JSON.parse(read(join('cities', file))));

describe('LICENSE', () => {
  it('is MIT for the project and keeps the upstream copyright notice', () => {
    const text = read('LICENSE');
    expect(text).toMatch(/^MIT License/);
    expect(text).toContain('Copyright (c) 2026 Goyo Cancio');
    expect(text).toContain('Copyright (c) 2026 Camille Roux');
  });
});

describe('NOTICE', () => {
  const text = read('NOTICE');

  it('credits the reference project at the same pinned commit as the app', () => {
    expect(text).toContain(REFERENCE_PROJECT.sha);
    expect(text).toContain(REFERENCE_PROJECT.url);
    expect(read('UPSTREAM.md')).toContain(REFERENCE_PROJECT.sha);
  });

  it('lists OpenStreetMap (ODbL), Photon and Nominatim', () => {
    expect(text).toMatch(/OpenStreetMap[\s\S]*ODbL/);
    expect(text).toContain('Photon');
    expect(text).toContain('Nominatim');
  });

  it('names every city data source with its license', () => {
    for (const city of cityConfigs()) {
      for (const source of city.attribution) {
        expect(text).toContain(source.name);
        expect(text).toContain(source.license);
      }
    }
  });
});
