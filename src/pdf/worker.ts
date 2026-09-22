import { GlobalWorkerOptions } from 'pdfjs-dist';
// Vite resolves this to a hashed local asset URL; it is bundled, never fetched
// from a CDN. The worker build must be the SAME pinned release as the library.
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

let configured = false;

/** Point PDF.js at the locally bundled worker exactly once. */
export function configurePdfWorker(): void {
  if (configured) return;
  configured = true;
  GlobalWorkerOptions.workerSrc = workerUrl;
}
