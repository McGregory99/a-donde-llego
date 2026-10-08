// Collapsible stats card: expanded on wide screens, collapsed on narrow ones so it never blocks the map.

/** Wires the toggle of `layout.statsCard`; `narrow` = the viewport is phone-sized. Returns { setExpanded, isExpanded }. */
export function createStatsCard({ statsCard, statsToggle }, t, { narrow = false } = {}) {
  let expanded = !narrow;
  const sync = () => {
    statsCard.classList.toggle('collapsed', !expanded);
    statsToggle.setAttribute('aria-expanded', String(expanded));
    statsToggle.textContent = t(expanded ? 'stats.hide' : 'stats.show');
  };
  statsToggle.addEventListener('click', () => {
    expanded = !expanded;
    sync();
  });
  sync();
  return {
    setExpanded(value) {
      expanded = Boolean(value);
      sync();
    },
    isExpanded: () => expanded,
  };
}
