// Validates every cities/<id>.json against cities/schema.json.
// Usage: node scripts/validate-cities.mjs [citiesDir]
import { readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';

export const DEFAULT_CITIES_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'cities',
);

export function validateCities(dir = DEFAULT_CITIES_DIR) {
  const schema = JSON.parse(readFileSync(join(dir, 'schema.json'), 'utf8'));
  const validate = new Ajv({ allErrors: true }).compile(schema);
  const errors = [];
  const files = readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'schema.json').sort();
  if (files.length === 0) errors.push(`${dir}: no city configs found`);
  for (const file of files) {
    let data;
    try {
      data = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    } catch (e) {
      errors.push(`${file}: invalid JSON (${e.message})`);
      continue;
    }
    if (!validate(data)) {
      for (const e of validate.errors) {
        const field = e.params.missingProperty
          ? `${e.instancePath}/${e.params.missingProperty}`
          : e.instancePath || '(root)';
        errors.push(`${file}: field '${field.replace(/^\//, '').replaceAll('/', '.')}': ${e.message}`);
      }
    } else if (data.id !== basename(file, '.json')) {
      errors.push(`${file}: field 'id': must equal file name '${basename(file, '.json')}'`);
    }
  }
  return errors;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const errors = validateCities(process.argv[2]);
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
  }
  console.log('City configs valid.');
}
