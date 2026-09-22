import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@model': fileURLToPath(new URL('./src/model', import.meta.url)),
      '@pdf': fileURLToPath(new URL('./src/pdf', import.meta.url)),
      '@notes': fileURLToPath(new URL('./src/notes', import.meta.url)),
      '@storage': fileURLToPath(new URL('./src/storage', import.meta.url)),
      '@export': fileURLToPath(new URL('./src/export', import.meta.url)),
      '@viewer': fileURLToPath(new URL('./src/viewer', import.meta.url)),
      '@author': fileURLToPath(new URL('./src/author', import.meta.url)),
      '@embed': fileURLToPath(new URL('./src/embed', import.meta.url)),
    },
  },
  test: {
    globals: true,
    // happy-dom for the DOM-touching tests (sanitizer, margin layout);
    // pure transform/model tests need no DOM but the env is cheap to share.
    environment: 'happy-dom',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    exclude: ['tests/e2e/**', 'node_modules/**'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.d.ts'],
    },
  },
});
