// "Acerca de" page wiring (R9.1, R9.3, R9.5): credits and licenses for the city named by ?c=.
import { pickCity } from '../cities.js';
import { t as defaultT } from '../i18n.js';
import { attributionEntries, renderAttributionPage } from './attribution.js';
import { loadCityAssets } from './data.js';

/** Renders the page into `root`. `base` is the site's public base path; `load` fetches city assets. */
export async function mountAbout(root, { cities, search, base, load = loadCityAssets, t = defaultT }) {
  const config = pickCity(cities, search);
  document.title = `${t('attribution.title')} · ${t('app.title')}`;

  // The credits do not depend on the feed dates, so a failed meta.json only drops that line.
  const meta = await load(config.id, ['meta'], { base: `${base}data/` })
    .then((assets) => assets.meta)
    .catch(() => null);

  renderAttributionPage(
    root,
    { entries: attributionEntries(config, t), meta, backHref: `${base}?c=${encodeURIComponent(config.id)}` },
    t,
  );
}
