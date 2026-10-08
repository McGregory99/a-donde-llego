// "Acerca de" page entry point.
import { cities } from './cities.js';
import { mountAbout } from './ui/about-page.js';
import './ui/styles.css';

await mountAbout(document.getElementById('app'), {
  cities,
  search: location.search,
  base: import.meta.env.BASE_URL,
});
