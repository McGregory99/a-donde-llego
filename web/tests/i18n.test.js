// R4.9, R5.7: every user-visible string comes from the Spanish resources through t().
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createT, describeLeg, formatMinutes, modeLabel, t } from '../src/i18n.js';

const SRC = fileURLToPath(new URL('../src', import.meta.url));
const es = JSON.parse(readFileSync(new URL('../i18n/es.json', import.meta.url), 'utf8'));

const sources = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? sources(join(dir, e.name)) : e.name.endsWith('.js') ? [join(dir, e.name)] : [],
  );
const lookup = (dict, key) => key.split('.').reduce((node, part) => node?.[part], dict);

describe('i18n translator', () => {
  const dict = { a: { b: 'Hola {name}, {n} min' }, plain: 'x' };
  const tt = createT(dict);

  it('resolves dotted keys and interpolates variables', () => {
    expect(tt('a.b', { name: 'Ana', n: 3 })).toBe('Hola Ana, 3 min');
    expect(tt('plain')).toBe('x');
  });

  it('returns the key for a missing entry and keeps unknown placeholders', () => {
    expect(tt('a.zzz')).toBe('a.zzz');
    expect(tt('a')).toBe('a');
    expect(tt('a.b', { name: 'Ana' })).toBe('Hola Ana, {n} min');
  });

  it('does not walk the prototype chain', () => {
    expect(tt('constructor')).toBe('constructor');
    expect(tt('__proto__.polluted')).toBe('__proto__.polluted');
  });

  it('has() tells whether a key exists', () => {
    expect(tt.has('a.b')).toBe(true);
    expect(tt.has('a.zzz')).toBe(false);
  });
});

describe('i18n resources', () => {
  it('every literal t() key used in web/src exists in es.json', () => {
    const used = new Set();
    for (const file of sources(SRC)) {
      for (const m of readFileSync(file, 'utf8').matchAll(/\b(?:t|translate)\(\s*['"]([\w.]+)['"]/g)) used.add(m[1]);
    }
    expect(used.size).toBeGreaterThan(5);
    const missing = [...used].filter((key) => typeof lookup(es, key) !== 'string');
    expect(missing).toEqual([]);
  });

  it('covers controls, isochrones, legs and errors; values are non-empty strings', () => {
    const leaves = (node) => (typeof node === 'string' ? [node] : Object.values(node).flatMap(leaves));
    leaves(es).forEach((value) => expect(value.trim()).not.toBe(''));
    for (const section of ['controls', 'isochrone', 'legend', 'legs', 'itinerary', 'errors', 'modes']) {
      expect(es[section], section).toBeTypeOf('object');
    }
    for (const key of ['invert', 'myPosition', 'share', 'shareCopied', 'departure', 'arrival', 'scale']) {
      expect(es.controls[key], key).toBeTypeOf('string');
    }
  });

  it('the default t() is Spanish', () => {
    expect(t('controls.share')).toBe(es.controls.share);
  });

  it('labels a mode by its id from the resources, falling back to the id', () => {
    expect(modeLabel('walk')).toBe(es.modes.walk);
    expect(modeLabel('unknown-mode')).toBe('unknown-mode');
  });
});

describe('i18n formatMinutes (R5.7)', () => {
  it('shows whole minutes, never 0 for a positive duration', () => {
    expect(formatMinutes(12.4)).toBe(12);
    expect(formatMinutes(12.6)).toBe(13);
    expect(formatMinutes(0.2)).toBe(1);
    expect(formatMinutes(0)).toBe(0);
  });
});

describe('i18n itinerary legs', () => {
  const graph = {
    stops: [{ name: 'Plaza' }, { name: 'Estación' }, { name: 'Museo' }],
    lines: [{ name: '4', route_id: 'R4', long_name: 'Centro - Estación' }, { name: '', route_id: 'R9', long_name: '' }],
  };
  const end = (stop, point = [0, 0]) => ({ stop, point });
  const text = (leg) => describeLeg(t, graph, leg);

  it('describes a walk to a stop and a walk to the final point', () => {
    expect(text({ type: 'walk', minutes: 4.4, from: end(null), to: end(0) })).toBe(
      t('legs.walk.toStop', { minutes: 4, stop: 'Plaza' }),
    );
    expect(text({ type: 'walk', minutes: 2, from: end(1), to: end(null) })).toBe(
      t('legs.walk.toPoint', { minutes: 2 }),
    );
    expect(text({ type: 'walk', minutes: 2, from: end(null), to: end(null) })).toBe(
      t('legs.walk.toPoint', { minutes: 2 }),
    );
  });

  it('describes wait and ride with line label, route and stop names', () => {
    expect(text({ type: 'wait', minutes: 3.6, stop: 0, line: 0 })).toBe(
      t('legs.wait', { minutes: 4, stop: 'Plaza', line: '4' }),
    );
    expect(text({ type: 'ride', minutes: 9, line: 0, from: 0, to: 1, stops: [0, 1] })).toBe(
      t('legs.ride.route', { minutes: 9, line: '4', route: 'Centro - Estación', from: 'Plaza', to: 'Estación' }),
    );
    // no name and no long name: falls back to the route id, no route text
    expect(text({ type: 'ride', minutes: 9, line: 1, from: 1, to: 2, stops: [1, 2] })).toBe(
      t('legs.ride.plain', { minutes: 9, line: 'R9', from: 'Estación', to: 'Museo' }),
    );
  });

  it('describes a transfer in place and between stops', () => {
    expect(text({ type: 'transfer', minutes: 1.5, walkMinutes: 0, penaltyMinutes: 1.5, fromStop: 1, toStop: 1 })).toBe(
      t('legs.transfer.same', { minutes: 2, stop: 'Estación' }),
    );
    expect(text({ type: 'transfer', minutes: 3, walkMinutes: 1.5, penaltyMinutes: 1.5, fromStop: 1, toStop: 2 })).toBe(
      t('legs.transfer.walk', { minutes: 3, from: 'Estación', to: 'Museo' }),
    );
  });

  it('the Spanish texts are real sentences with the numbers filled in', () => {
    expect(text({ type: 'wait', minutes: 3.6, stop: 0, line: 0 })).toMatch(/Espera 4 min.*línea 4.*Plaza/);
    expect(text({ type: 'walk', minutes: 4.4, from: end(null), to: end(0) })).toMatch(/Camina 4 min.*Plaza/);
  });

  it('rejects an unknown leg type with a clear error', () => {
    expect(() => text({ type: 'fly', minutes: 1 })).toThrow(/fly/);
  });

  it('tolerates a missing stop or line name', () => {
    const bare = { stops: [{}], lines: [{}] };
    const bareText = (leg) => describeLeg(t, bare, leg);
    expect(bareText({ type: 'wait', minutes: 1, stop: 0, line: 0 })).toBe(t('legs.wait', { minutes: 1, stop: '0', line: '0' }));
    // indices with no entry at all
    expect(text({ type: 'wait', minutes: 1, stop: 9, line: 9 })).toBe(t('legs.wait', { minutes: 1, stop: '9', line: '9' }));
    expect(text({ type: 'ride', minutes: 2, line: 9, from: 8, to: 9, stops: [8, 9] })).toBe(
      t('legs.ride.plain', { minutes: 2, line: '9', from: '8', to: '9' }),
    );
    for (const out of [bareText({ type: 'wait', minutes: 1, stop: 0, line: 0 }), text({ type: 'wait', minutes: 1, stop: 9, line: 9 })]) {
      expect(out).not.toMatch(/undefined|\{/);
    }
  });
});
