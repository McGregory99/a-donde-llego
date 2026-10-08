// Credits (R9.1-R9.5): city data sources come from the city config, the rest are global to the product.
import { t as defaultT } from '../i18n.js';
import { formatDate } from './stats.js';

/** The project this one started from (see UPSTREAM.md); the SHA is the vendored commit. */
export const REFERENCE_PROJECT = {
  name: 'À portée de tram',
  author: 'Camille Roux',
  url: 'https://github.com/camilleroux/montpellier-temps-transport',
  license: 'MIT',
  sha: '8fb45be2cbaf51be6916107148969f98c441a408',
};

const OSM = { name: 'OpenStreetMap', url: 'https://www.openstreetmap.org/copyright', license: 'ODbL' };

// Geocoder providers a city config may select (geocoder.provider / geocoder.reverse.provider).
const GEOCODERS = {
  photon: { name: 'Photon (Komoot)', url: 'https://photon.komoot.io', license: 'ODbL', textKey: 'attribution.photon' },
  nominatim: { name: 'Nominatim (OpenStreetMap)', url: 'https://nominatim.org', license: 'ODbL', textKey: 'attribution.nominatim' },
};

/** Credits in display order. `bar` entries also appear in the short line over the map. */
export function attributionEntries(config, t = defaultT) {
  const city = (config.attribution ?? []).map((source) => ({ ...source, text: source.text ?? source.name, bar: true }));
  const geocoders = [config.geocoder?.provider, config.geocoder?.reverse?.provider]
    .filter((provider, index, all) => GEOCODERS[provider] && all.indexOf(provider) === index)
    .map((provider) => {
      const { textKey, ...entry } = GEOCODERS[provider];
      return { ...entry, text: t(textKey), bar: false };
    });
  const reference = {
    name: REFERENCE_PROJECT.name,
    url: REFERENCE_PROJECT.url,
    license: REFERENCE_PROJECT.license,
    text: t('attribution.reference', { author: REFERENCE_PROJECT.author }),
    detail: t('attribution.commit', { sha: REFERENCE_PROJECT.sha }),
    bar: false,
  };
  return [...city, { ...OSM, text: t('attribution.osm'), detail: t('attribution.osmText'), bar: true }, ...geocoders, reference];
}

function node(tag, attributes = {}, children = []) {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (name === 'text') element.textContent = value;
    else element.setAttribute(name, value);
  }
  element.append(...children);
  return element;
}

const externalLink = (href, text) => node('a', { href, rel: 'noopener noreferrer', target: '_blank', text });

/** Persistent one-line credit shown over the map, with a link to the about page. */
export function renderAttributionBar(container, entries, aboutHref, t = defaultT) {
  const credits = entries.filter((entry) => entry.bar);
  container.replaceChildren(
    ...credits.flatMap((entry, index) => [
      ...(index ? [document.createTextNode(' · ')] : []),
      entry.url ? externalLink(entry.url, entry.text) : document.createTextNode(entry.text),
    ]),
    document.createTextNode(' · '),
    node('a', { href: aboutHref, text: t('attribution.about') }),
  );
}

/** Full attribution page: every credit with its license, the feed validity and a link back to the map. */
export function renderAttributionPage(container, { entries, meta, backHref }, t = defaultT) {
  const feed = meta?.feed;
  const items = entries.map((entry) =>
    node('li', { class: 'credit' }, [
      node('h2', {}, [entry.url ? externalLink(entry.url, entry.name) : document.createTextNode(entry.name)]),
      ...(entry.license ? [node('p', { class: 'credit-license', text: t('attribution.license', { license: entry.license }) })] : []),
      node('p', { text: entry.text }),
      ...(entry.detail ? [node('p', { class: 'credit-detail', text: entry.detail })] : []),
    ]),
  );
  container.replaceChildren(
    node('h1', { text: t('attribution.title') }),
    node('p', { text: t('attribution.intro') }),
    ...(feed
      ? [node('p', { class: 'credit-feed', text: t('attribution.feedDates', { from: formatDate(feed.valid_from), to: formatDate(feed.valid_to) }) })]
      : []),
    node('ul', { class: 'credits' }, items),
    node('p', {}, [node('a', { href: backHref, text: t('attribution.back') })]),
  );
}
