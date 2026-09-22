import { test, expect, type Route } from '@playwright/test';
import { readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { unzipSync } from 'fflate';

/**
 * Milestone-1 end-to-end publication slice.
 *
 *   import a PDF → create a note → mark it public → publish (export ZIP) →
 *   drop the ZIP into a NESTED subdirectory of a SECOND origin (:5199) →
 *   load the reader there with EVERY off-origin request blocked →
 *   confirm the note renders.
 *
 * This is the contract that unit tests cannot prove: the exported reading is a
 * relocatable, self-contained static asset with no runtime dependency on the
 * Fermat app domain or any external origin.
 */

const AUTHOR = 'http://localhost:5173/';
const READER_ORIGIN = 'http://localhost:5199';
const NESTED = 'deeply/nested/path/my-reading';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const serveDir = `${repoRoot}/tests/e2e-serve/${NESTED}`;
const samplePdf = `${repoRoot}/tests/fixtures/sample.pdf`;

test('publish a reading and serve it self-contained from a second origin', async ({ page }) => {
  // 1) Author: import the sample PDF.
  await page.goto(AUTHOR);
  await expect(page.locator('.fa-app')).toBeVisible();

  // The import button triggers a hidden file input; set files on it directly.
  const fileInput = page.locator('input[type="file"][accept*="pdf"]').first();
  await fileInput.setInputFiles(samplePdf);

  // The document opens; its pages render.
  await expect(page.locator('.fa-page').first()).toBeVisible({ timeout: 30_000 });

  // 2) Create a text note by selecting a line in the first page's text layer.
  const line = page.locator('.fa-textlayer span', { hasText: 'selectable line' }).first();
  await expect(line).toBeVisible({ timeout: 30_000 });
  await line.dblclick(); // selects a word/line
  // The selection toolbar appears; click "Highlight + note".
  const hlBtn = page.locator('.fa-seltoolbar button', { hasText: 'Highlight' });
  await expect(hlBtn).toBeVisible();
  await hlBtn.click();

  // A margin card now exists. Type a note body and mark public.
  const card = page.locator('.fa-card').first();
  await expect(card).toBeVisible();
  const NOTE = 'Endianness matters here.';
  await card.locator('textarea').fill(NOTE);
  await card.locator('.fa-toggle input[type="checkbox"]').check();
  // Commit by blurring.
  await page.locator('.fa-doc-name').click();
  await expect(card.locator('[data-role="state"]')).toHaveText(/Saved/, { timeout: 10_000 });

  // 3) Publish — capture the downloaded ZIP.
  const downloadPromise = page.waitForEvent('download');
  page.on('dialog', (d) => void d.accept()); // accept any preflight confirm
  await page.locator('button', { hasText: 'Publish reader' }).click();
  const download = await downloadPromise;
  const zipPath = await download.path();
  const zipBytes = new Uint8Array(readFileSync(zipPath));

  // 4) Unzip into a nested subdirectory of the second origin's static root.
  rmSync(`${repoRoot}/tests/e2e-serve`, { recursive: true, force: true });
  mkdirSync(serveDir, { recursive: true });
  const files = unzipSync(zipBytes);
  for (const [name, bytes] of Object.entries(files)) {
    const dest = `${serveDir}/${name}`;
    mkdirSync(dest.substring(0, dest.lastIndexOf('/')), { recursive: true });
    writeFileSync(dest, Buffer.from(bytes));
  }

  // 5) Load the reader from the SECOND origin, BLOCKING every off-origin request.
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

  // 6) The published note renders — served entirely from local, nested assets.
  await expect(page.locator('.fx-reader')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.fx-card-body', { hasText: NOTE })).toBeVisible({ timeout: 30_000 });

  // The private/authoring machinery never ran here; and nothing was requested
  // from the app origin (:5173) or any external host.
  expect(offOrigin, `reader requested off-origin URLs: ${offOrigin.join(', ')}`).toEqual([]);
});
