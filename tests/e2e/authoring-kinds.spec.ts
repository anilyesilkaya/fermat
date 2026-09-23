import { test, expect, type Route } from '@playwright/test';
import { readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { unzipSync } from 'fflate';

/**
 * Authoring completeness: create a REGION note (Box tool) and a POINT note (Pin
 * tool), give one a color, publish, and confirm both render in the exported,
 * self-contained reader. Plus a regression guard: in Select mode neither a bare
 * page click nor a text drag may create a note (the bug this milestone fixed).
 *
 * These are the note kinds that make Fermat work on figures and scanned/image
 * PDFs — not just text-layer PDFs — so proving them end-to-end is the milestone's
 * definition of done.
 */

const AUTHOR = 'http://localhost:5173/';
const READER_ORIGIN = 'http://localhost:5199';
const NESTED = 'kinds/reader';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const serveDir = `${repoRoot}/tests/e2e-serve/${NESTED}`;
const samplePdf = `${repoRoot}/tests/fixtures/sample.pdf`;

test('author region + point notes and read them back from a static export', async ({ page }) => {
  // A tall viewport so the whole first page (≈1069px at 1.35× zoom) is on-screen
  // and every drag/click coordinate is reachable by the mouse.
  await page.setViewportSize({ width: 1400, height: 1300 });

  // 1) Import the sample PDF and wait for the first page to render.
  await page.goto(AUTHOR);
  await expect(page.locator('.fa-app')).toBeVisible();
  await page.locator('input[type="file"][accept*="pdf"]').first().setInputFiles(samplePdf);
  const pageMain = page.locator('.fa-page-main').first();
  await expect(pageMain).toBeVisible({ timeout: 30_000 });
  const box = (await pageMain.boundingBox())!;

  // --- Regression: Select mode must create NOTHING ------------------------
  await page.locator('.fa-tool[data-tool="select"]').click();
  // A bare click on the page.
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.4);
  // A drag across text (would previously have started a rubber-band region).
  await page.mouse.move(box.x + 30, box.y + 30);
  await page.mouse.down();
  await page.mouse.move(box.x + 220, box.y + 34, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator('.fa-card')).toHaveCount(0);

  // --- Box tool → a region note -------------------------------------------
  await page.locator('.fa-tool[data-tool="box"]').click();
  await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.25);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.45, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('.fa-card')).toHaveCount(1);

  // --- Pin tool → a point note --------------------------------------------
  await page.locator('.fa-tool[data-tool="pin"]').click();
  await page.mouse.click(box.x + box.width * 0.7, box.y + box.height * 0.7);
  await expect(page.locator('.fa-card')).toHaveCount(2);
  // A point highlight is rendered as a pin dot.
  await expect(page.locator('.fa-hl-point')).toHaveCount(1);

  // 2) Fill both notes, set a color on the region note, mark both public.
  const cards = page.locator('.fa-card');
  const REGION_NOTE = 'This figure shows the layout.';
  const POINT_NOTE = 'Look precisely here.';
  await cards.nth(0).locator('textarea').fill(REGION_NOTE);
  await cards.nth(0).locator('.fa-swatch').nth(2).click(); // pick a preset color
  await cards.nth(1).locator('textarea').fill(POINT_NOTE);
  for (let i = 0; i < 2; i++) {
    await cards.nth(i).locator('.fa-toggle input[type="checkbox"]').check();
  }
  // Commit by blurring focus.
  await page.locator('.fa-doc-name').click();
  await expect(cards.nth(1).locator('[data-role="state"]')).toHaveText(/Saved/, { timeout: 10_000 });

  // 3) Publish and capture the ZIP.
  const downloadPromise = page.waitForEvent('download');
  page.on('dialog', (d) => void d.accept());
  await page.locator('button', { hasText: 'Publish reader' }).click();
  const download = await downloadPromise;
  const zipBytes = new Uint8Array(readFileSync(await download.path()));

  // 4) Unzip into a nested subdir of the second (reader) origin.
  rmSync(`${repoRoot}/tests/e2e-serve`, { recursive: true, force: true });
  mkdirSync(serveDir, { recursive: true });
  for (const [name, bytes] of Object.entries(unzipSync(zipBytes))) {
    const dest = `${serveDir}/${name}`;
    mkdirSync(dest.substring(0, dest.lastIndexOf('/')), { recursive: true });
    writeFileSync(dest, Buffer.from(bytes));
  }

  // 5) Open the reader from the reader origin with ALL off-origin blocked.
  const offOrigin: string[] = [];
  await page.route('**/*', (route: Route) => {
    const url = route.request().url();
    if (url.startsWith(READER_ORIGIN) || url.startsWith('data:') || url.startsWith('blob:')) {
      return route.continue();
    }
    offOrigin.push(url);
    return route.abort();
  });
  await page.goto(`${READER_ORIGIN}/${NESTED}/index.html`);

  // 6) Both kinds rendered: two cards, a point pin, and both bodies.
  await expect(page.locator('.fx-reader')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.fx-card-body', { hasText: REGION_NOTE })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.fx-card-body', { hasText: POINT_NOTE })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.fx-hl-point')).toHaveCount(1);

  expect(offOrigin, `reader requested off-origin URLs: ${offOrigin.join(', ')}`).toEqual([]);
});
