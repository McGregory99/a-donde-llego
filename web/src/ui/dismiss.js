// Keyboard dismissal: Escape removes the destination marker and its itinerary.

/** Listens on `target`; returns a function that stops listening. `app` = { getState, dispatch }. */
export function bindDismiss(target, app) {
  const onKey = (event) => {
    if (event.key !== 'Escape' || event.defaultPrevented || !app.getState().destination) return;
    app.dispatch({ type: 'destination', point: null });
  };
  target.addEventListener('keydown', onKey);
  return () => target.removeEventListener('keydown', onKey);
}
