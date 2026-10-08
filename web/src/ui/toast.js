// Non-blocking message in a live region; a newer message replaces the old one.

/** Returns show(message) for `element`, which hides itself after `delayMs`. */
export function createToast(element, delayMs = 3500) {
  let timer = null;
  return (message) => {
    element.textContent = message;
    element.hidden = false;
    clearTimeout(timer);
    timer = setTimeout(() => {
      element.hidden = true;
    }, delayMs);
  };
}
