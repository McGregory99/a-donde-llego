// Registered cities: every cities/<id>.json is bundled, so adding a city needs no code change (R1.4).
const modules = import.meta.glob(['../../cities/*.json', '!../../cities/schema.json'], { eager: true, import: 'default' });

export const cities = Object.values(modules).sort((a, b) => a.id.localeCompare(b.id));

/** The city named by `?c=` in `search`, else the first registered one. */
export function pickCity(list, search) {
  if (!list.length) throw new Error('no city is registered in cities/');
  const wanted = new URLSearchParams(search).get('c');
  return list.find((city) => city.id === wanted) ?? [...list].sort((a, b) => a.id.localeCompare(b.id))[0];
}
