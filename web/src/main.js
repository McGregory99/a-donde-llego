// Entry point: pick the city from the URL/config, load its static assets and mount the app.
import { cities, pickCity } from './cities.js';
import { createGeocoder } from './geocoder/index.js';
import { t } from './i18n.js';
import { createApp } from './ui/app.js';
import { attributionEntries, renderAttributionBar } from './ui/attribution.js';
import { createControls } from './ui/controls.js';
import { loadCityData } from './ui/data.js';
import { locate } from './ui/geolocate.js';
import { renderTrip } from './ui/panel.js';
import { buildShareUrl, shareLink } from './ui/share.js';
import { renderExpiryBanner, renderStats } from './ui/stats.js';
import './ui/styles.css';

const root = document.getElementById('app');
root.textContent = t('app.loading');

async function start() {
  const config = pickCity(cities, location.search);
  const data = await loadCityData(config.id, { base: `${import.meta.env.BASE_URL}data/` });
  const app = createApp({ config, data, root, search: location.search });

  createControls(app.layout.controls, app, {
    geocoder: createGeocoder(config),
    locate: (isInside) => locate(navigator.geolocation, isInside),
    share: (url, title) => shareLink(navigator, url, title),
    shareUrl: (state) => buildShareUrl(state, location),
    t,
  });

  renderExpiryBanner(app.layout.banner, data.meta, t);
  renderStats(app.layout.stats, data.stats, t);
  renderAttributionBar(
    app.layout.attribution,
    attributionEntries(config, t),
    `${import.meta.env.BASE_URL}acerca.html?c=${encodeURIComponent(config.id)}`,
    t,
  );

  const paintTrip = (state, { trip }) => renderTrip(app.layout.panel, { graph: data.graph, state, trip }, t);
  app.subscribe(paintTrip);
  paintTrip(app.getState(), { trip: app.trip() });
}

start().catch((error) => {
  console.error(error);
  root.textContent = t(error.key ?? 'errors.dataLoad');
});
