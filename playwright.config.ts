import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests exercise the browser-only slice that unit tests can't:
 *   - the authoring app running against real IndexedDB + PDF.js in a browser,
 *   - the EXPORTED reader served from a SECOND origin at a NESTED subdirectory,
 *     with every non-local request treated as a contract violation.
 *
 * Two web servers are started:
 *   - :5173  the Fermat authoring dev server (Vite), for import/annotate/export.
 *   - :5199  a plain static server rooted at tests/e2e-serve, standing in for an
 *            unrelated static host (a different origin) where a published reading
 *            is dropped into a nested path.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env['CI'],
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'vite --port 5173 --strictPort',
      port: 5173,
      reuseExistingServer: !process.env['CI'],
      timeout: 120_000,
    },
    {
      // Static host for the exported reader (a different origin than :5173).
      command: 'node tests/static-server.mjs 5199 tests/e2e-serve',
      port: 5199,
      reuseExistingServer: !process.env['CI'],
      timeout: 60_000,
    },
  ],
});
