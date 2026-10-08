// Release gate: the deploy must not publish a site with an expired timetable feed or a city without data.
// Usage: node scripts/release-gate.mjs [dataDir] [citiesDir]   (exit 1 and the reasons on stderr when blocked)
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Reasons the release is blocked, one per problem; empty when every city in `citiesDir` is releasable on `today` (YYYY-MM-DD). */
export function checkRelease({ dataDir = join(ROOT, 'dist', 'data'), citiesDir = join(ROOT, 'cities'), today }) {
  const cities = readdirSync(citiesDir)
    .filter((file) => file.endsWith('.json') && file !== 'schema.json')
    .map((file) => file.replace(/\.json$/, ''))
    .sort();
  const problems = cities.length ? [] : [`${citiesDir}: no city configs found`];
  for (const city of cities) {
    let meta;
    try {
      meta = JSON.parse(readFileSync(join(dataDir, city, 'meta.json'), 'utf8'));
    } catch (error) {
      problems.push(`${city}: cannot read ${join(dataDir, city, 'meta.json')} (${error.code ?? error.message})`);
      continue;
    }
    const validTo = meta?.feed?.valid_to;
    if (!ISO_DATE.test(validTo ?? '')) problems.push(`${city}: meta.json has no feed.valid_to date`);
    else if (meta.feed.expired) problems.push(`${city}: feed expired (valid until ${validTo})`);
    else if (validTo < today) problems.push(`${city}: feed ended on ${validTo}, before ${today}`);
  }
  return problems;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [dataDir, citiesDir] = process.argv.slice(2);
  const today = new Date().toISOString().slice(0, 10);
  const problems = checkRelease({ today, ...(dataDir && { dataDir }), ...(citiesDir && { citiesDir }) });
  for (const problem of problems) console.error(`release gate: ${problem}`);
  if (problems.length) process.exit(1);
  console.log(`release gate: ok (${today})`);
}
