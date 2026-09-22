import { PdfDocument } from '../pdf/document';
import { loadReading } from './load';
import { Reader } from './reader';

/**
 * Reader entry point. This is the ONLY code the exported bundle runs. It:
 *   1. loads + validates the local manifest/annotations (relative URLs),
 *   2. fetches the local PDF bytes (only now — not while showing the shell),
 *   3. opens the PDF and mounts the Reader.
 *
 * Everything is same-directory and relative, so the reading works at any nested
 * path with external domains blocked. There is no authoring, storage, import, or
 * export code in this bundle.
 */

async function bootstrap(): Promise<void> {
  const mount = document.getElementById('reader');
  if (!mount) throw new Error('missing #reader mount element');

  try {
    const baseUrl = document.baseURI;
    const reading = await loadReading(baseUrl);

    // Fetch the PDF bytes now (deferred until after the shell is ready).
    const res = await fetch(reading.pdfUrl);
    if (!res.ok) throw new Error(`failed to load document.pdf (${res.status})`);
    const bytes = new Uint8Array(await res.arrayBuffer());

    // Bundled font/cmap assets (Vite fingerprints these into assets/).
    const pdf = await PdfDocument.open(bytes, {
      standardFontDataUrl: new URL('./assets/standard_fonts/', baseUrl).href,
      cMapUrl: new URL('./assets/cmaps/', baseUrl).href,
    });

    const reader = new Reader(mount, pdf, reading);
    await reader.init();
  } catch (err) {
    renderError(mount, err);
  }
}

function renderError(mount: HTMLElement, err: unknown): void {
  const doc = mount.ownerDocument;
  const box = doc.createElement('div');
  box.className = 'fx-error';
  box.textContent = `Could not open this reading: ${
    err instanceof Error ? err.message : String(err)
  }`;
  mount.appendChild(box);
}

void bootstrap();
