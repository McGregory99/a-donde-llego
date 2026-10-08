// "Acerca de" page: credits and licenses for the city named by ?c= (R9.1, R9.3, R9.5).
import { cities, pickCity } from './cities.js';
import { t } from './i18n.js';
import { attributionEntries, renderAttributionPage } from './ui/attribution.js';
import { loadCityAssets } from './ui/data.js';
import './ui/styles.css';

const root = document.getElementById('app');
const config = pickCity(cities, location.search);
document.title = `${t('attribution.title')} · ${t('app.title')}`;

// The credits do not depend on the feed dates, so a failed meta.json only drops that line.
const meta = await loadCityAssets(config.id, ['meta'], { base: `${import.meta.env.BASE_URL}data/` })
  .then((assets) => assets.meta)
  .catch(() => null);

renderAttributionPage(root, { entries: attributionEntries(config, t), meta, backHref: `${import.meta.env.BASE_URL}?c=${encodeURIComponent(config.id)}` }, t);
