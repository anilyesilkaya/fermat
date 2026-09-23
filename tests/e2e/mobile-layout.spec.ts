import { test, expect, type Route } from '@playwright/test';
import { readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { unzipSync } from 'fflate';

/**
 * Mobile-layout contract. A published reading is the artifact people open on a
 * phone, so it MUST fit a narrow viewport with no horizontal scroll and with the
 * page scaled down to fit (not clipped). The authoring app must also not overflow
 * its chrome on a phone, though its PDF page keeps natural size (gestures map 1:1
 * to page pixels, so it scrolls rather than scaling).
 *
 * Regression guard for the fixed-pixel page/overlay sizing that used to force a
 * ~765px-wide page and a ~562px-wide app onto a 390px screen.
 */

const AUTHOR = 'http://localhost:5173/';
const READER_ORIGIN = 'http://localhost:5199';
const NESTED = 'mobile/reader';
const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const serveDir = `${repoRoot}/tests/e2e-serve/${NESTED}`;
const samplePdf = `${repoRoot}/tests/fixtures/sample.pdf`;

// iPhone 12/13/14 logical viewport.
const PHONE = { width: 390, height: 844 };

test('author app fits a phone viewport without horizontal overflow', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto(AUTHOR);
  await expect(page.locator('.fa-app')).toBeVisible();
  await page.locator('input[type="file"][accept*="pdf"]').first().setInputFiles(samplePdf);
  await expect(page.locator('.fa-page-main').first()).toBeVisible({ timeout: 30_000 });

  const m = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
    toolbarClipped:
      (document.querySelector('.fa-toolbar')?.scrollWidth ?? 0) >
      (document.querySelector('.fa-toolbar')?.clientWidth ?? 0) + 1,
    sidebarW: document.querySelector('.fa-sidebar')?.getBoundingClientRect().width ?? 0,
  }));

  // The app chrome does not overflow the viewport, and the toolbar wraps instead
  // of clipping its tools.
  expect(m.scrollW).toBeLessThanOrEqual(m.clientW + 1);
  expect(m.toolbarClipped).toBe(false);
  // The sidebar spans the full width (stacked layout), not a fixed 300px column.
  expect(m.sidebarW).toBeGreaterThan(m.clientW - 2);
});

test('published reader fits a phone: page scales down, no horizontal scroll', async ({ page }) => {
  // Author at desktop size, then read on a phone.
  await page.setViewportSize({ width: 1400, height: 1300 });
  await page.goto(AUTHOR);
  await expect(page.locator('.fa-app')).toBeVisible();
  await page.locator('input[type="file"][accept*="pdf"]').first().setInputFiles(samplePdf);
  const pageMain = page.locator('.fa-page-main').first();
  await expect(pageMain).toBeVisible({ timeout: 30_000 });
  const box = (await pageMain.boundingBox())!;

  // A region note near the top-left and a point note, both public, so the reader
  // has a highlight whose placement we can check after the page scales down.
  await page.locator('.fa-tool[data-tool="box"]').click();
  await page.mouse.move(box.x + box.width * 0.15, box.y + box.height * 0.12);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.28, { steps: 8 });
  await page.mouse.up();
  const NOTE = 'Readable on a phone without horizontal scrolling.';
  const card = page.locator('.fa-card').first();
  await expect(card).toBeVisible();
  await card.locator('textarea').fill(NOTE);
  await card.locator('.fa-toggle input[type="checkbox"]').check();
  await page.locator('.fa-doc-name').click();
  await expect(card.locator('[data-role="state"]')).toHaveText(/Saved/, { timeout: 10_000 });

  const downloadPromise = page.waitForEvent('download');
  page.on('dialog', (d) => void d.accept());
  await page.locator('button', { hasText: 'Publish reader' }).click();
  const download = await downloadPromise;
  const zipBytes = new Uint8Array(readFileSync(await download.path()));

  rmSync(`${repoRoot}/tests/e2e-serve`, { recursive: true, force: true });
  mkdirSync(serveDir, { recursive: true });
  for (const [name, bytes] of Object.entries(unzipSync(zipBytes))) {
    const dest = `${serveDir}/${name}`;
    mkdirSync(dest.substring(0, dest.lastIndexOf('/')), { recursive: true });
    writeFileSync(dest, Buffer.from(bytes));
  }

  // Open the reader on a phone with every off-origin request blocked.
  await page.setViewportSize(PHONE);
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
  await expect(page.locator('.fx-reader')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.fx-card-body', { hasText: NOTE })).toBeVisible({ timeout: 30_000 });

  const m = await page.evaluate(() => {
    const scroll = document.querySelector('.fx-scroll') as HTMLElement | null;
    const main = document.querySelector('.fx-page-main') as HTMLElement | null;
    const hl = document.querySelector('.fx-hl:not(.fx-hl-point)') as HTMLElement | null;
    const mainRect = main?.getBoundingClientRect();
    const hlRect = hl?.getBoundingClientRect();
    return {
      innerW: window.innerWidth,
      docScrollW: document.documentElement.scrollWidth,
      docClientW: document.documentElement.clientWidth,
      scrollOverflow: scroll ? scroll.scrollWidth - scroll.clientWidth : 0,
      pageW: mainRect?.width ?? 0,
      // Highlight must sit INSIDE the (scaled) page box — proof the % overlay
      // tracks the page instead of drifting off at a smaller scale.
      hlInsidePage:
        !!mainRect &&
        !!hlRect &&
        hlRect.left >= mainRect.left - 1 &&
        hlRect.right <= mainRect.right + 1 &&
        hlRect.top >= mainRect.top - 1,
    };
  });

  // No horizontal scrolling anywhere.
  expect(m.docScrollW).toBeLessThanOrEqual(m.docClientW + 1);
  expect(m.scrollOverflow).toBeLessThanOrEqual(1);
  // The page scaled DOWN to fit the narrow column (natural width is ~765px).
  expect(m.pageW).toBeLessThan(m.innerW);
  // The highlight overlay stayed pinned to the page after scaling.
  expect(m.hlInsidePage).toBe(true);
  // Still fully self-contained.
  expect(offOrigin, `reader requested off-origin URLs: ${offOrigin.join(', ')}`).toEqual([]);
});
