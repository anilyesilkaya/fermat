import { defineConfig, type Plugin } from 'vite';
import { fileURLToPath, URL } from 'node:url';
import { cpSync, existsSync } from 'node:fs';

/**
 * Copy PDF.js's local font + CMap resources into the viewer's assets/ so a
 * published reading can render standard-14 fonts and CJK text with external
 * domains blocked. Without these, PDF.js falls back to a remote fetch, breaking
 * the "self-contained, works offline" contract. They are static (no hashing) so
 * exports stay reproducible; ~2.3MB per reading is the cost of true offline use.
 */
function copyPdfAssets(): Plugin {
  return {
    name: 'fermat-copy-pdf-assets',
    apply: 'build',
    // writeBundle runs AFTER Vite empties outDir and writes its own output, so
    // the copied dirs survive; generateBundle would be clobbered by emptyOutDir.
    writeBundle() {
      const pkg = fileURLToPath(new URL('./node_modules/pdfjs-dist', import.meta.url));
      const outRoot = fileURLToPath(new URL('./dist-viewer/assets', import.meta.url));
      for (const dir of ['standard_fonts', 'cmaps']) {
        const src = `${pkg}/${dir}`;
        if (existsSync(src)) cpSync(src, `${outRoot}/${dir}`, { recursive: true });
      }
    },
  };
}

/**
 * Read-only viewer build — the code that ships inside every published reading.
 *
 * Constraints enforced by keeping this a separate build:
 *   - No authoring, IndexedDB, PDF-import, or ZIP-export code is reachable from
 *     the viewer entry, so none of it lands in the exported bundle.
 *   - Relative asset paths (`base: './'`) so the reader works when relocated to
 *     any nested subdirectory of a static host, with no server rewrites.
 *   - All runtime resources (viewer JS/CSS, PDF worker, CMaps, math assets that
 *     are actually used) are emitted locally under assets/.
 *
 * Output is copied into an export scaffold by src/export at author time.
 */
export default defineConfig({
  root: 'src/viewer',
  base: './',
  plugins: [copyPdfAssets()],
  resolve: {
    alias: {
      '@model': fileURLToPath(new URL('./src/model', import.meta.url)),
      '@pdf': fileURLToPath(new URL('./src/pdf', import.meta.url)),
      '@notes': fileURLToPath(new URL('./src/notes', import.meta.url)),
    },
  },
  build: {
    outDir: fileURLToPath(new URL('./dist-viewer', import.meta.url)),
    emptyOutDir: true,
    sourcemap: false,
    target: 'es2022',
    // Deterministic asset names (no content-hash timestamps churn) keep exports
    // reproducible; the export step versions the whole assets/ dir by viewer id.
    rollupOptions: {
      output: {
        entryFileNames: 'assets/viewer.js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
  worker: {
    format: 'es',
  },
});
