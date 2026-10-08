// End-to-end on a production build (served under the Pages base path) with the fixture city (R4.2, R5.1, R7.2).
import { expect, test } from '@playwright/test';

const CITY = '?c=valladolid';
// Origin next to fixture stop S1; the view fits the fixture stops, so the canvas centre is a few hundred metres from S2.
const ORIGIN = 'o=41.601,-4.749';

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

const clickCentre = async (page) => {
  const box = await page.locator('#map').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
};

test('loads the city from the static data and shows the stats panel', async ({ page }) => {
  await open(page);
  await expect(page.locator('h1')).not.toBeEmpty();
  await expect(page.locator('.stats [data-stat="lines"]')).toHaveText('3');
  await expect(page.locator('.stats [data-stat="bestHeadway"]')).toContainText('min');
  await expect(page.locator('.attribution')).toContainText('AUVASA');
});

test('paints the heat map on the canvas', async ({ page }) => {
  await open(page);
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const canvas = document.getElementById('map');
        const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
        const colours = new Set();
        for (let i = 0; i < data.length; i += 4 * 97) colours.add(`${data[i]},${data[i + 1]},${data[i + 2]},${data[i + 3]}`);
        return colours.size;
      }),
    )
    .toBeGreaterThan(3);
});

test('clicking the map shows an itinerary and records the destination in the URL', async ({ page }) => {
  await open(page);
  await clickCentre(page);
  await expect(page.locator('.trip-panel')).toBeVisible();
  await expect(page.locator('.trip-panel li').first()).toBeVisible();
  expect(page.url()).toMatch(/[?&]d=/);
});

test('invert swaps the direction and inverting again restores the itinerary', async ({ page }) => {
  await open(page);
  await clickCentre(page);
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
  await clickCentre(page);
  await page.locator('input[type=range]').fill('90');
  await expect(page.locator('.trip-panel li').first()).toBeVisible();
  const shared = page.url();
  expect(shared).toMatch(/max=90/);
  const summary = await page.locator('.trip-panel').innerText();

  const other = await (await browser.newContext()).newPage();
  await other.goto(shared);
  await expect(other.locator('.trip-panel li').first()).toBeVisible();
  expect(await other.locator('.trip-panel').innerText()).toBe(summary);
  expect(await other.locator('input[type=range]').inputValue()).toBe('90');
  expect(other.url()).toBe(shared);
});

test('an invalid link shows a notice and falls back to the defaults', async ({ page }) => {
  await page.goto(`./?${CITY}&o=10,10&iso=99`);
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
  await page.goto(`./?${CITY}&${ORIGIN}`);
  await expect(page.locator('#map')).toBeVisible();
  await expect(page.locator('.stats')).toBeHidden();
  await clickCentre(page);
  await expect(page.locator('.trip-panel li').first()).toBeVisible();
  consoleErrors.length = 0; // the browser logs the intentional 404
});
