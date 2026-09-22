import { test, expect, type Route } from '@playwright/test';
import { existsSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';

/**
 * Demo bookshelf e2e.
 *
 *   serve examples/ as plain static files (a stand-in for GitHub Pages) →
 *   open the bookshelf index → click a title → the self-contained reader opens
 *   and renders its published margin notes — with EVERY off-origin request
 *   blocked.
 *
 * This proves the deliverable the user asked for: an index.html where you pick a
 * PDF title and its annotated version opens in the browser, deployable to a
 * static host with no runtime dependency on any app domain or CDN.
 */

const ORIGIN = 'http://localhost:5200';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const built = existsSync(`${repoRoot}/examples/readers`);

test.skip(!built, 'run `node scripts/build-examples.mjs` first');

test('pick a title on the bookshelf and read its annotated PDF', async ({ page }) => {
  // Block every off-origin request up front — the reader must be self-contained.
  const offOrigin: string[] = [];
  await page.route('**/*', (route: Route) => {
    const url = route.request().url();
    if (url.startsWith(ORIGIN) || url.startsWith('data:') || url.startsWith('blob:')) {
      return route.continue();
    }
    offOrigin.push(url);
    return route.abort();
  });

  // 1) The bookshelf lists titles.
  await page.goto(`${ORIGIN}/index.html`);
  const firstCard = page.locator('.card-link').first();
  await expect(firstCard).toBeVisible();
  const title = (await firstCard.locator('h2').textContent())?.trim() ?? '';
  expect(title.length).toBeGreaterThan(0);

  // 2) Pick a title → its reader opens.
  await firstCard.click();
  await expect(page).toHaveURL(/\/readers\/[^/]+\/index\.html$/);
  await expect(page.locator('.fx-reader')).toBeVisible({ timeout: 30_000 });

  // 3) The published note(s) render, and the title carried through.
  await expect(page.locator('.fx-title')).toHaveText(title, { timeout: 30_000 });
  await expect(page.locator('.fx-card-body').first()).toBeVisible({ timeout: 30_000 });
  const cardText = (await page.locator('.fx-card-body').first().textContent())?.trim() ?? '';
  expect(cardText.length).toBeGreaterThan(0);

  // 4) A page canvas rendered (the PDF itself drew, fully offline).
  await expect(page.locator('.fx-page canvas').first()).toBeVisible({ timeout: 30_000 });

  // Nothing was fetched off-origin.
  expect(offOrigin, `reader requested off-origin URLs: ${offOrigin.join(', ')}`).toEqual([]);
});
