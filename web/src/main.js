// Entry point: pick the city from the URL/config, load its static assets and mount the app.
import { cities, pickCity } from './cities.js';
import { t } from './i18n.js';
import { createApp } from './ui/app.js';
import { loadCityData } from './ui/data.js';
import './ui/styles.css';

const root = document.getElementById('app');
root.textContent = t('app.loading');

async function start() {
  const config = pickCity(cities, location.search);
  const data = await loadCityData(config.id, { base: `${import.meta.env.BASE_URL}data/` });
  createApp({ config, data, root, search: location.search });
}

start().catch((error) => {
  console.error(error);
  root.textContent = t(error.key ?? 'errors.dataLoad');
});
