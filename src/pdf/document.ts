import {
  getDocument,
  AnnotationMode,
  TextLayer,
  type PDFDocumentProxy,
  type PDFDocumentLoadingTask,
  type PDFPageProxy,
} from 'pdfjs-dist';
import { configurePdfWorker } from './worker';
import { makeViewport, effectiveScale, type Viewport, type ViewBoxTuple, type QuarterTurn } from './transforms';

/**
 * PDF.js document lifecycle adapter.
 *
 * Security posture (the source PDF is untrusted):
 *   - `enableXfa: false` and we render with `AnnotationMode.ENABLE` (not
 *     ENABLE_FORMS/STORAGE), so no interactive form scripting runs.
 *   - We never wire a scripting manager, so PDF JavaScript actions never
 *     execute. (In this PDF.js release eval-based paths are disabled by default
 *     and not exposed as a public option.)
 *   - `useSystemFonts: false` and local `standardFontDataUrl`/`cMapUrl` keep all
 *     resources bundled — no network fetches to a CDN or the authoring site.
 *
 * Resource management: pages are rendered on demand and callers are expected to
 * keep only a bounded window of live pages (see the viewer's virtualization) and
 * to `close()` the document to release the worker + buffers.
 */

export interface OpenPdfOptions {
  /** Local URL for standard font data (bundled). */
  standardFontDataUrl?: string;
  /** Local URL for CMaps (bundled). */
  cMapUrl?: string;
}

export interface PageInfo {
  pageIndex: number;
  viewBox: ViewBoxTuple;
  /** Inherent page rotation (quarter turn). */
  rotation: QuarterTurn;
  userUnit: number;
}

export class PdfDocument {
  private constructor(
    private readonly proxy: PDFDocumentProxy,
    private readonly task: PDFDocumentLoadingTask,
    readonly pageCount: number,
  ) {}

  /**
   * Open a PDF from raw bytes. Bytes are copied by PDF.js; the caller keeps the
   * canonical immutable copy (and its SHA-256) separately.
   */
  static async open(bytes: Uint8Array, options: OpenPdfOptions = {}): Promise<PdfDocument> {
    configurePdfWorker();
    const task = getDocument({
      // Copy so PDF.js's transfer/detach cannot neuter the caller's buffer.
      data: bytes.slice(),
      useSystemFonts: false,
      enableXfa: false,
      ...(options.standardFontDataUrl ? { standardFontDataUrl: options.standardFontDataUrl } : {}),
      // pdfjs-dist ships CMaps as binary-packed `.bcmap`, so cMapPacked must be
      // true whenever we point at a local cMapUrl — otherwise CJK CMap loading
      // fails and the reader would fall back to a remote fetch (or break offline).
      ...(options.cMapUrl ? { cMapUrl: options.cMapUrl, cMapPacked: true } : {}),
    });
    const proxy = await task.promise;
    return new PdfDocument(proxy, task, proxy.numPages);
  }

  /** Fetch a page proxy (0-based index). */
  private async page(pageIndex: number): Promise<PDFPageProxy> {
    // PDF.js pages are 1-based.
    return this.proxy.getPage(pageIndex + 1);
  }

  /** Canonical page frame info for anchoring. */
  async pageInfo(pageIndex: number): Promise<PageInfo> {
    const page = await this.page(pageIndex);
    const view = page.view as number[];
    const viewBox: ViewBoxTuple = [view[0]!, view[1]!, view[2]!, view[3]!];
    return {
      pageIndex,
      viewBox,
      rotation: normalizeQuarter(page.rotate),
      userUnit: page.userUnit ?? 1,
    };
  }

  /**
   * Build the canonical viewport for a page at a css zoom. Folds the page's
   * UserUnit into the render scale so the overlay and canvas agree.
   */
  async viewport(pageIndex: number, cssZoom: number, extraRotation: QuarterTurn = 0): Promise<Viewport> {
    const info = await this.pageInfo(pageIndex);
    const scale = effectiveScale(cssZoom, info.userUnit);
    const rotation = ((info.rotation + extraRotation) % 360) as QuarterTurn;
    return makeViewport(info.viewBox, scale, rotation);
  }

  /**
   * Render a page into a canvas at the given viewport. The canvas backing store
   * should already be sized for DPR by the caller (see canvasBackingSize); the
   * transform passed to PDF.js accounts for that scale.
   */
  async render(
    pageIndex: number,
    canvas: HTMLCanvasElement,
    cssZoom: number,
    devicePixelRatio: number,
    extraRotation: QuarterTurn = 0,
  ): Promise<void> {
    const page = await this.page(pageIndex);
    const info = await this.pageInfo(pageIndex);
    const scale = effectiveScale(cssZoom, info.userUnit);
    const rotation = (info.rotation + extraRotation) % 360;
    const pjViewport = page.getViewport({ scale, rotation });

    const dpr = devicePixelRatio > 0 ? devicePixelRatio : 1;
    canvas.width = Math.round(pjViewport.width * dpr);
    canvas.height = Math.round(pjViewport.height * dpr);
    canvas.style.width = `${pjViewport.width}px`;
    canvas.style.height = `${pjViewport.height}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas context unavailable');

    await page.render({
      canvas,
      canvasContext: ctx,
      viewport: pjViewport,
      transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
      // Render existing (embedded) annotations for display, but do NOT enable
      // forms/scripting/storage.
      annotationMode: AnnotationMode.ENABLE,
    }).promise;
  }

  /**
   * Render a selectable text layer into `container`, aligned to the same
   * viewport used for the canvas. PDF.js positions transparent spans over the
   * page so the browser's native selection yields per-line client rects (which
   * the author maps to quads via lineRectsToQuads). Returns the TextLayer so the
   * caller can cancel it when the page is torn down.
   *
   * `container` must be positioned (the caller sets position/inset) and sized to
   * the CSS viewport; PDF.js writes CSS variables + spans into it.
   */
  async renderTextLayer(
    pageIndex: number,
    container: HTMLElement,
    cssZoom: number,
    extraRotation: QuarterTurn = 0,
  ): Promise<TextLayer> {
    const page = await this.page(pageIndex);
    const info = await this.pageInfo(pageIndex);
    const scale = effectiveScale(cssZoom, info.userUnit);
    const rotation = (info.rotation + extraRotation) % 360;
    const pjViewport = page.getViewport({ scale, rotation });
    const textContentSource = page.streamTextContent({
      includeMarkedContent: true,
      disableNormalization: true,
    });
    const layer = new TextLayer({ textContentSource, container, viewport: pjViewport });
    await layer.render();
    return layer;
  }

  /** Extract plain text items for a page (for search + quote context). */
  async textItems(pageIndex: number): Promise<{ str: string }[]> {
    const page = await this.page(pageIndex);
    const content = await page.getTextContent();
    const out: { str: string }[] = [];
    for (const item of content.items) {
      // TextItem has `str`; TextMarkedContent does not — narrow structurally.
      const str = (item as { str?: unknown }).str;
      if (typeof str === 'string') out.push({ str });
    }
    return out;
  }

  /**
   * Count embedded comment-style annotations already present in the source PDF
   * (Text/FreeText/Highlight/Ink/Square/Popup, etc.). Used by publication
   * preflight — these are part of the PDF bytes, not Fermat notes.
   */
  async countEmbeddedComments(): Promise<number> {
    const COMMENT_SUBTYPES = new Set([
      'Text', 'FreeText', 'Highlight', 'Underline', 'StrikeOut', 'Squiggly',
      'Ink', 'Square', 'Circle', 'Polygon', 'PolyLine', 'Stamp', 'Caret', 'Popup',
    ]);
    let count = 0;
    for (let i = 0; i < this.pageCount; i++) {
      const page = await this.page(i);
      const annotations = await page.getAnnotations();
      for (const a of annotations) {
        const subtype = (a as { subtype?: string }).subtype;
        if (subtype && COMMENT_SUBTYPES.has(subtype)) count++;
      }
    }
    return count;
  }

  /** Release the worker and buffers. Call when the document is closed. */
  async close(): Promise<void> {
    await this.proxy.cleanup();
    // destroy() lives on the loading task; it aborts requests and kills the worker.
    await this.task.destroy();
  }
}

function normalizeQuarter(rotate: number): QuarterTurn {
  let r = rotate % 360;
  if (r < 0) r += 360;
  return (r === 90 || r === 180 || r === 270 ? r : 0) as QuarterTurn;
}
