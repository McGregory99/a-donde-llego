// Address search box (R6.1-R6.4, R6.6): suggestions while typing, Enter picks the best match.
const MIN_CHARS = 3;

/**
 * Mounts the search form in `container`. `geocoder` = { suggest(q), search(q) } (see geocoder/index.js);
 * `onSelect({label, lat, lon})` runs on a choice; `onError(key)` gets the i18n key of a failure (non-blocking).
 */
export function createSearch(container, { geocoder, t, onSelect, onError }) {
  const form = document.createElement('form');
  form.className = 'search';
  form.setAttribute('role', 'search');
  form.autocomplete = 'off';
  const input = document.createElement('input');
  input.type = 'search';
  input.placeholder = t('controls.searchPlaceholder');
  input.setAttribute('aria-label', t('controls.search'));
  const list = document.createElement('ul');
  list.className = 'search-results';
  list.hidden = true;
  const note = document.createElement('p');
  note.className = 'search-note';
  note.hidden = true;
  form.append(input, list, note);
  container.append(form);

  const clear = () => {
    list.replaceChildren();
    list.hidden = true;
    note.hidden = true;
  };

  function choose(place) {
    clear();
    input.value = place.label;
    onSelect(place);
  }

  function show({ results, outside }) {
    list.replaceChildren(
      ...results.map((place) => {
        const item = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = place.label;
        button.addEventListener('click', () => choose(place));
        item.append(button);
        return item;
      }),
    );
    list.hidden = !results.length;
    const message = !results.length
      ? t('controls.noResults')
      : outside > 0
        ? t('controls.resultsOutside', { count: outside })
        : '';
    note.textContent = message;
    note.hidden = !message;
  }

  const fail = (error) => onError(error?.key ?? 'errors.geocoder');

  input.addEventListener('input', async () => {
    const query = input.value.trim();
    if (query.length < MIN_CHARS) {
      clear();
      return;
    }
    try {
      const answer = await geocoder.suggest(query);
      if (answer) show(answer);
    } catch (error) {
      clear();
      fail(error);
    }
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const query = input.value.trim();
    if (query.length < MIN_CHARS) return;
    try {
      const answer = await geocoder.search(query);
      if (answer.results.length) choose(answer.results[0]);
      else show(answer);
    } catch (error) {
      fail(error);
    }
  });

  document.addEventListener('click', (event) => {
    if (!form.contains(event.target)) clear();
  });

  return { input };
}
