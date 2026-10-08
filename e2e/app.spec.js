// End-to-end on a production build (served under the Pages base path) with the fixture city (R4.2, R5.1, R7.2).
import { expect, test } from '@playwright/test';

const CITY = '?c=valladolid';
// Origin on the street fixture stop S1 snaps to (walking follows the real Valladolid streets of the committed OSM cache).
const ORIGIN = 'o=41.59986,-4.74982';

const consoleErrors = [];
test.beforeEach(({ page }) => {
  consoleErrors.length = 0;
  page.on('pageerror', (error) => consoleErrors.push(error.message));
  page.on('console', (message) => message.type() === 'error' && consoleErrors.push(message.text()));
});
test.afterEach(() => {
  expect(consoleErrors).toEqual([]);
});

const open = async (page, query = `${CITY}&${ORIGIN}`) => {
  await page.goto(`./?${query.replace(/^\?/, '')}`);
  await expect(page.locator('#map')).toBeVisible();
  await expect(page.locator('.stats [data-stat="stops"]')).toHaveText('4');
};

// Walking follows streets, so a click must land within 150 m of one: the fixture stops all sit by a street.
// Zooms in, sweeps synthetic mouse moves for the stop named `name` and returns its page position. "Two" is
// 22 min from the origin by the S1 -> S2 bus, inside the default colour scale.
const findStop = async (page, name = 'Two') => {
  for (let i = 0; i < 3; i += 1) await page.click('[data-action="zoom-in"]');
  return page.evaluate((wanted) => {
    const canvas = document.getElementById('map');
    const rect = canvas.getBoundingClientRect();
    const tip = document.querySelector('.stop-tooltip');
    for (let y = 4; y < rect.height; y += 4) {
      for (let x = 4; x < rect.width; x += 4) {
        canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: rect.left + x, clientY: rect.top + y, pointerId: 7, pointerType: 'mouse', bubbles: true }));
        if (!tip.hidden && tip.textContent === wanted) return { x: rect.left + x, y: rect.top + y };
      }
    }
    return null;
  }, name);
};

const clickStop = async (page) => {
  const stop = await findStop(page);
  expect(stop).not.toBeNull();
  await page.mouse.click(stop.x, stop.y);
  return stop;
};

test('loads the city from the static data and shows the stats panel', async ({ page }) => {
  await open(page);
  await expect(page.locator('h1')).not.toBeEmpty();
  await expect(page.locator('.stats [data-stat="lines"]')).toHaveText('3');
  await expect(page.locator('.stats [data-stat="bestHeadway"]')).toContainText('min');
  await expect(page.locator('.attribution')).toContainText('AUVASA');
});

const canvasColours = (page) =>
  page.evaluate(() => {
    const canvas = document.getElementById('map');
    const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    const counts = { distinct: new Set(), green: 0, red: 0, grey: 0 };
    for (let i = 0; i < data.length; i += 4) {
      const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
      if (i % 97 === 0) counts.distinct.add(`${r},${g},${b}`);
      if (g > r - 30 && g > b + 80) counts.green += 1; // the near end of the ramp: yellow-green
      else if (r > g + 60 && r > b + 60) counts.red += 1; // the far end
      else if (Math.abs(r - g) < 6 && Math.abs(g - b) < 14 && r > 190 && r < 236) counts.grey += 1; // neutral streets
    }
    return { ...counts, distinct: counts.distinct.size };
  });

test('paints streets: travel-time colours on the street segments and the neutral grey for the rest', async ({ page }) => {
  await open(page);
  for (let i = 0; i < 3; i += 1) await page.click('[data-action="zoom-in"]');
  await expect.poll(async () => (await canvasColours(page)).distinct).toBeGreaterThan(3);
  const colours = await canvasColours(page);
  expect(colours.red).toBeGreaterThan(0); // streets far from the origin are opaque warm ramp colours
  expect(colours.grey).toBeGreaterThan(0); // streets beyond the scale keep the base style
});

test('streets are painted as lines, not as an area fill', async ({ page }) => {
  await open(page);
  for (let i = 0; i < 3; i += 1) await page.click('[data-action="zoom-in"]');
  const share = await page.evaluate(() => {
    const canvas = document.getElementById('map');
    const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    let coloured = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i + 1] > data[i] + 40 && data[i + 1] > data[i + 2] + 60) coloured += 1;
    return coloured / (canvas.width * canvas.height);
  });
  expect(share).toBeGreaterThan(0);
  expect(share).toBeLessThan(0.25); // a raster fill would colour most of the walkable disc; streets leave gaps
});

test('clicking the map shows an itinerary and records the destination in the URL', async ({ page }) => {
  await open(page);
  await clickStop(page);
  await expect(page.locator('.trip-panel')).toBeVisible();
  await expect(page.locator('.trip-panel li').first()).toBeVisible();
  expect(page.url()).toMatch(/[?&]d=/);
});

test('invert swaps the direction and inverting again restores the itinerary', async ({ page }) => {
  await open(page);
  await clickStop(page);
  await expect(page.locator('.trip-panel li').first()).toBeVisible();
  await page.click('[data-action="invert"]');
  await expect.poll(() => page.url()).toMatch(/dir=arrival/);
  // The fixture lines only run S1 -> S4, so arriving at S1 from the middle of the map has no transit trip.
  await expect(page.locator('.trip-panel')).toBeVisible();
  await expect(page.locator('.trip-panel li')).toHaveCount(0);
  await page.click('[data-action="invert"]');
  await expect.poll(() => page.url()).not.toMatch(/dir=arrival/);
  await expect(page.locator('.trip-panel li').first()).toBeVisible();
});

test('a shared URL reproduces the same state in a fresh page', async ({ page, browser }) => {
  await open(page);
  await clickStop(page);
  await page.locator('input[type=range]').fill('90');
  await expect(page.locator('.trip-panel li').first()).toBeVisible();
  const shared = page.url();
  expect(shared).toMatch(/max=90/);
  const summary = await page.locator('.trip-panel').innerText();

  const context = await browser.newContext();
  const other = await context.newPage();
  await other.goto(shared);
  await expect(other.locator('.trip-panel li').first()).toBeVisible();
  expect(await other.locator('.trip-panel').innerText()).toBe(summary);
  expect(await other.locator('input[type=range]').inputValue()).toBe('90');
  expect(other.url()).toBe(shared);
  await context.close();
});

test('an invalid link shows a notice and falls back to the defaults', async ({ page }) => {
  await page.goto(`./${CITY}&o=10,10&iso=99`);
  expect(page.url()).toMatch(/\/\?c=valladolid&/);
  await expect(page.locator('.toast')).toBeVisible();
  await expect(page.locator('.toast')).toContainText('enlace');
  await expect(page.locator('#map')).toBeVisible();
});

test('the "Acerca de" page lists the credits and links back to the map under the same base', async ({ page }) => {
  await open(page);
  await page.locator('.attribution a').last().click();
  await expect(page).toHaveURL(/\/a-donde-llego\/acerca\.html\?c=valladolid$/);
  await expect(page.locator('body')).toContainText('OpenStreetMap');
  await expect(page.locator('body')).toContainText('AUVASA');
  await page.getByRole('link', { name: 'Volver al mapa' }).click();
  await expect(page).toHaveURL(/\/a-donde-llego\/\?c=valladolid$/);
  await expect(page.locator('#map')).toBeVisible();
});

test('the map still loads when stats.json is missing and the stats panel stays hidden', async ({ page }) => {
  await page.route('**/data/valladolid/stats.json', (route) => route.fulfill({ status: 404, body: 'not found' }));
  await page.goto(`./${CITY}&${ORIGIN}`);
  expect(page.url()).toMatch(/\/\?c=valladolid&/);
  await expect(page.locator('#map')).toBeVisible();
  await expect(page.locator('.stats')).toBeHidden();
  await clickStop(page);
  await expect(page.locator('.trip-panel li').first()).toBeVisible();
  consoleErrors.length = 0; // the browser logs the intentional 404
});

test('the close button removes the destination, the itinerary and the d parameter', async ({ page }) => {
  await open(page);
  await clickStop(page);
  await expect(page.locator('.trip-panel')).toBeVisible();
  expect(page.url()).toMatch(/[?&]d=/);
  await page.getByRole('button', { name: 'Quitar destino' }).click();
  await expect(page.locator('.trip-panel')).toBeHidden();
  expect(page.url()).not.toMatch(/[?&]d=/);
});

test('Escape removes the destination', async ({ page }) => {
  await open(page);
  await clickStop(page);
  await expect(page.locator('.trip-panel')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.trip-panel')).toBeHidden();
  expect(page.url()).not.toMatch(/[?&]d=/);
});

test('clicking the arrival marker removes it instead of moving it', async ({ page }) => {
  await open(page);
  const stop = await clickStop(page);
  await expect(page.locator('.trip-panel')).toBeVisible();
  await page.mouse.click(stop.x, stop.y); // the marker sits where the first click landed
  await expect(page.locator('.trip-panel')).toBeHidden();
  expect(page.url()).not.toMatch(/[?&]d=/);
});

test('"Solo a pie" and back changes the reachable trip and persists in the URL', async ({ page }) => {
  await open(page);
  const transit = page.getByRole('radio', { name: /\+ a pie$/ });
  const walkOnly = page.getByRole('radio', { name: 'Solo a pie' });
  await expect(transit).toBeChecked();
  await clickStop(page);
  await expect(page.locator('.trip-panel li').first()).toBeVisible();

  await walkOnly.check();
  await expect(walkOnly).toBeChecked();
  await expect.poll(() => page.url()).toMatch(/modes=&/);
  await expect(page.locator('.trip-panel li')).toHaveCount(0); // too far to walk
  await expect(page.locator('.legend')).toContainText('a pie');

  const shared = page.url();
  await page.goto(shared);
  await expect(page.getByRole('radio', { name: 'Solo a pie' })).toBeChecked();

  await page.getByRole('radio', { name: /\+ a pie$/ }).check();
  await expect.poll(() => page.url()).not.toMatch(/modes=&/);
  await expect(page.locator('.trip-panel li').first()).toBeVisible();
});

test('stops show their name on hover once zoomed in, and stay hidden when zoomed out', async ({ page }) => {
  await open(page);
  const tooltip = page.locator('.stop-tooltip');
  // Sweep synthetic mouse moves over the canvas inside the page (fast); the tooltip appears when one lands on a stop.
  const sweep = () =>
    page.evaluate(() => {
      const canvas = document.getElementById('map');
      const rect = canvas.getBoundingClientRect();
      const tip = document.querySelector('.stop-tooltip');
      for (let y = 4; y < rect.height; y += 8) {
        for (let x = 4; x < rect.width; x += 8) {
          canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: rect.left + x, clientY: rect.top + y, pointerId: 7, pointerType: 'mouse', bubbles: true }));
          if (!tip.hidden) return true;
        }
      }
      return false;
    });
  expect(await sweep()).toBe(false); // zoomed out: no stop is interactive
  for (let i = 0; i < 3; i += 1) await page.click('[data-action="zoom-in"]');
  expect(await sweep()).toBe(true);
  await expect(tooltip).toHaveText(/^(One|Two|Three|Four)$/);
});

const intersects = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const visibleBoxes = async (page, selectors) => {
  const boxes = {};
  for (const selector of selectors) {
    const locator = page.locator(selector);
    if (await locator.isVisible()) boxes[selector] = await locator.boundingBox();
  }
  return boxes;
};
const noOverlaps = (boxes) => {
  const names = Object.keys(boxes);
  const clashes = [];
  names.forEach((a, i) => names.slice(i + 1).forEach((b) => intersects(boxes[a], boxes[b]) && clashes.push(`${a} x ${b}`)));
  return clashes;
};

test('desktop: the map fills the viewport and the stats card toggles without covering other panels', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await open(page);
  await clickStop(page);
  await expect(page.locator('.trip-panel')).toBeVisible();
  const map = await page.locator('#map').boundingBox();
  expect(map).toMatchObject({ x: 0, y: 0, width: 1280, height: 720 });
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight)).toBe(true);

  const card = page.locator('.stats-card');
  const toggle = page.getByRole('button', { name: 'Ocultar cifras' });
  await expect(page.locator('.stats')).toBeVisible();
  const panels = ['.overlay-left .topbar', '.trip-panel', '.stats-card', '.legend', '.attribution', '.zoom'];
  expect(noOverlaps(await visibleBoxes(page, panels))).toEqual([]);
  await page.screenshot({ path: process.env.ADL_SHOTS ? `${process.env.ADL_SHOTS}/ws-layout-desktop.png` : 'test-results/ws-layout-desktop.png' });

  await toggle.click();
  await expect(page.locator('.stats')).toBeHidden();
  await expect(card).toBeVisible();
  await page.getByRole('button', { name: 'Ver cifras' }).click();
  await expect(page.locator('.stats')).toBeVisible();
});

test('mobile: the map fills the screen, the stats start collapsed and nothing overlaps', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await clickStop(page);
  await expect(page.locator('.trip-panel')).toBeVisible();
  expect(await page.locator('#map').boundingBox()).toMatchObject({ x: 0, y: 0, width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.locator('.stats')).toBeHidden();
  await expect(page.locator('.expiry-banner')).toBeHidden(); // fresh fixture: no banner
  const panels = ['.overlay-left .topbar', '.trip-panel', '.stats-card', '.legend', '.attribution', '.zoom'];
  expect(noOverlaps(await visibleBoxes(page, panels))).toEqual([]);
  await page.screenshot({ path: process.env.ADL_SHOTS ? `${process.env.ADL_SHOTS}/ws-layout-mobile.png` : 'test-results/ws-layout-mobile.png' });
  await page.getByRole('button', { name: 'Ver cifras' }).click();
  await expect(page.locator('.stats')).toBeVisible();
});

// Contours are closed lines drawn at every zoom (no zoom threshold), in both travel modes. The label is canvas text, so
// the observable effect of a toggle is a change of the canvas pixels. Walking alone only reaches ~13 min of streets
// (max_access_m), so its front is the 15 min one; with the bus the 45 min one is inside the fixture's reach.
for (const [name, query, minutes] of [
  ['Autobús + a pie', `${CITY}&${ORIGIN}&iso=60&max=90`, 45],
  ['Solo a pie', `${CITY}&${ORIGIN}&modes=&iso=60&max=90`, 15],
]) {
  test(`"${name}": toggling the ${minutes} min isochrone changes the map at the default zoom`, async ({ page }) => {
    await open(page, query);
    const snapshot = () => page.locator('#map').screenshot();
    const before = await snapshot();
    await page.locator(`input[data-iso="${minutes}"]`).check();
    await expect.poll(async () => !(await snapshot()).equals(before)).toBe(true);
    const during = await snapshot();
    await page.locator(`input[data-iso="${minutes}"]`).uncheck();
    await expect.poll(async () => !(await snapshot()).equals(during)).toBe(true);
  });
}
