import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

/**
 * Authoring-app build.
 *
 * The read-only viewer is built separately (see `vite.viewer.config.ts`) so that
 * the authoring bundle and the exported reader never share a chunk graph: the
 * viewer must not pull in the IndexedDB layer, PDF import, or ZIP-export code.
 *
 * The export module packages the viewer by reading its already-built assets at
 * author runtime; it does not import viewer source directly. See src/export.
 */
export default defineConfig({
  root: '.',
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
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    target: 'es2022',
  },
  worker: {
    format: 'es',
  },
});
