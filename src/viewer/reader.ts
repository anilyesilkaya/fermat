import type { PdfDocument } from '../pdf/document';
import type { Viewport } from '../pdf/transforms';
import {
  anchorHighlightRects,
  anchorTopViewportY,
  layoutMarginCards,
  parseDeepLink,
  serializeDeepLink,
  renderNoteMarkdown,
  pageLabel,
  type CardInput,
} from '../notes';
import type { LoadedReading, LoadedAnnotation } from './load';
import { desiredLivePages, diffLivePages, type VisibleRange } from './virtualize';
import { ensureReaderStyles } from './styles';

/**
 * The reader runtime: renders the published PDF with its notes in an adjacent
 * margin, virtualizes pages so only a bounded window of canvases is live,
 * links highlights ↔ note cards both ways, and honors `#page=&note=` deep links.
 *
 * All rendering is local: it draws from the already-opened `PdfDocument` (bytes
 * verified by the caller) and the validated public annotations. No network use.
 */

interface PageFrame {
  pageIndex: number;
  viewport: Viewport;
  annotations: LoadedAnnotation[];
  /** The page container (canvas + overlay live inside). */
  main: HTMLElement;
  overlay: HTMLElement;
  margin: HTMLElement;
  canvas: HTMLCanvasElement | null;
  /** Rendered note-card elements keyed by annotation id. */
  cards: Map<string, HTMLElement>;
  /** Highlight rect elements keyed by annotation id (one card → many rects). */
  highlights: Map<string, HTMLElement[]>;
  rendered: boolean;
}

export interface ReaderOptions {
  cssZoom?: number;
  overscan?: number;
  devicePixelRatio?: number;
}

export class Reader {
  private readonly root: HTMLElement;
  private readonly scroll: HTMLElement;
  private readonly pageInfo: HTMLElement;
  private readonly frames: PageFrame[] = [];
  private readonly visible = new Set<number>();
  private readonly live = new Set<number>();
  private readonly cssZoom: number;
  private readonly overscan: number;
  private readonly dpr: number;
  private observer: IntersectionObserver | null = null;
  private activeNoteId: string | null = null;

  constructor(
    private readonly container: HTMLElement,
    private readonly pdf: PdfDocument,
    private readonly reading: LoadedReading,
    options: ReaderOptions = {},
  ) {
    this.cssZoom = options.cssZoom ?? 1.25;
    this.overscan = options.overscan ?? 1;
    this.dpr =
      options.devicePixelRatio ??
      (typeof globalThis !== 'undefined' && 'devicePixelRatio' in globalThis
        ? (globalThis as { devicePixelRatio?: number }).devicePixelRatio ?? 1
        : 1);

    const doc = container.ownerDocument;
    ensureReaderStyles(doc);

    this.root = doc.createElement('div');
    this.root.className = 'fx-reader';

    const header = doc.createElement('header');
    header.className = 'fx-header';
    const title = doc.createElement('h1');
    title.className = 'fx-title';
    title.textContent = this.reading.manifest.title;
    this.pageInfo = doc.createElement('span');
    this.pageInfo.className = 'fx-pageinfo';
    header.append(title, this.pageInfo);

    this.scroll = doc.createElement('div');
    this.scroll.className = 'fx-scroll';

    this.root.append(header, this.scroll);
    container.appendChild(this.root);
  }

  /** Build page frames, wire virtualization, and honor the initial deep link. */
  async init(): Promise<void> {
    const byPage = groupByPage(this.reading.annotations);

    // Precompute each page's viewport. This is metadata-only (page dictionaries),
    // O(pageCount) — fine for the papers/reports this targets. Pixel buffers, the
    // real cost, stay bounded by virtualization below.
    for (let i = 0; i < this.pdf.pageCount; i++) {
      const viewport = await this.pdf.viewport(i, this.cssZoom);
      const frame = this.buildFrame(i, viewport, byPage.get(i) ?? []);
      this.frames.push(frame);
      this.scroll.appendChild(frame.main.parentElement as HTMLElement);
    }

    this.setupObserver();
    this.window.addEventListener?.('hashchange', this.onHashChange);

    const link = parseDeepLink(this.location?.hash ?? '');
    if (link.pageIndex !== undefined) {
      this.scrollToPage(link.pageIndex);
    }
    // Ensure at least the first pages render even before the observer fires.
    this.reconcileLive({ first: link.pageIndex ?? 0, last: link.pageIndex ?? 0 });
    if (link.noteId) this.focusNote(link.noteId, { updateHash: false });
    this.updatePageInfo();
  }

  // --- frame construction -------------------------------------------------

  private buildFrame(
    pageIndex: number,
    viewport: Viewport,
    annotations: LoadedAnnotation[],
  ): PageFrame {
    const doc = this.container.ownerDocument;

    const pageEl = doc.createElement('div');
    pageEl.className = 'fx-page';
    pageEl.dataset['pageIndex'] = String(pageIndex);

    const main = doc.createElement('div');
    main.className = 'fx-page-main';
    // Natural size is the page's CSS-pixel width; aspect-ratio holds its shape so
    // it scales down (never up) to fit narrow screens without horizontal scroll.
    main.style.width = `${viewport.width}px`;
    main.style.aspectRatio = `${viewport.width} / ${viewport.height}`;

    const placeholder = doc.createElement('div');
    placeholder.className = 'fx-page-placeholder';
    placeholder.textContent = `Page ${pageLabel(pageIndex)}`;
    main.appendChild(placeholder);

    const overlay = doc.createElement('div');
    overlay.className = 'fx-highlights';
    main.appendChild(overlay);

    const margin = doc.createElement('div');
    margin.className = 'fx-margin';
    margin.style.minHeight = `${viewport.height}px`;

    pageEl.append(main, margin);

    return {
      pageIndex,
      viewport,
      annotations,
      main,
      overlay,
      margin,
      canvas: null,
      cards: new Map(),
      highlights: new Map(),
      rendered: false,
    };
  }

  // --- virtualization -----------------------------------------------------

  private setupObserver(): void {
    const IO = (this.window as { IntersectionObserver?: typeof IntersectionObserver })
      .IntersectionObserver;
    if (!IO) return; // e.g. headless test env — reconcileLive is still called directly.
    this.observer = new IO(
      (entries) => {
        for (const entry of entries) {
          const idx = Number((entry.target as HTMLElement).dataset['pageIndex']);
          if (entry.isIntersecting) this.visible.add(idx);
          else this.visible.delete(idx);
        }
        this.reconcileLive(this.visibleRange());
        this.updatePageInfo();
      },
      { root: this.scroll, rootMargin: '200px 0px' },
    );
    for (const f of this.frames) this.observer.observe(f.main.parentElement as HTMLElement);
  }

  private visibleRange(): VisibleRange {
    if (this.visible.size === 0) return { first: 0, last: 0 };
    let first = Infinity;
    let last = -Infinity;
    for (const i of this.visible) {
      if (i < first) first = i;
      if (i > last) last = i;
    }
    return { first, last };
  }

  /** Bring the live-canvas set in line with the desired window. */
  private reconcileLive(range: VisibleRange): void {
    const desired = desiredLivePages(range, this.frames.length, this.overscan);
    const { toMount, toUnmount } = diffLivePages(this.live, desired);
    for (const i of toUnmount) this.unmountPage(i);
    for (const i of toMount) void this.mountPage(i);
  }

  private async mountPage(pageIndex: number): Promise<void> {
    const frame = this.frames[pageIndex];
    if (!frame || this.live.has(pageIndex)) return;
    this.live.add(pageIndex);

    const doc = this.container.ownerDocument;
    const canvas = doc.createElement('canvas');
    canvas.className = 'fx-page-canvas';
    // Insert canvas beneath the overlay.
    frame.main.insertBefore(canvas, frame.overlay);
    frame.canvas = canvas;

    try {
      await this.pdf.render(pageIndex, canvas, this.cssZoom, this.dpr);
    } catch {
      // If a later scroll already unmounted this page, drop the stale render.
      if (!this.live.has(pageIndex)) return;
    }
    // A concurrent unmount may have fired while we awaited the render.
    if (!this.live.has(pageIndex)) return;

    // render() sets a FIXED-pixel CSS size on the canvas; override it so the
    // bitmap fills its (fluid, max-width-constrained) page box instead — this is
    // what lets a page shrink to fit a phone. The DPR-scaled backing store is
    // unchanged, so the downscaled render stays crisp.
    canvas.style.width = '100%';
    canvas.style.height = '100%';

    const placeholder = frame.main.querySelector('.fx-page-placeholder');
    placeholder?.remove();

    if (!frame.rendered) {
      this.renderHighlights(frame);
      await this.renderCards(frame);
      frame.rendered = true;
    }
  }

  private unmountPage(pageIndex: number): void {
    const frame = this.frames[pageIndex];
    if (!frame || !this.live.has(pageIndex)) return;
    this.live.delete(pageIndex);
    // Release the pixel buffer — the memory that must stay bounded.
    if (frame.canvas) {
      frame.canvas.width = 0;
      frame.canvas.height = 0;
      frame.canvas.remove();
      frame.canvas = null;
    }
  }

  // --- highlights + cards -------------------------------------------------

  private renderHighlights(frame: PageFrame): void {
    const doc = this.container.ownerDocument;
    const { width: vw, height: vh } = frame.viewport;
    for (const ann of frame.annotations) {
      const isPoint = ann.anchor.kind === 'point';
      const rects = anchorHighlightRects(frame.viewport, ann.anchor);
      const els: HTMLElement[] = [];
      for (const r of rects) {
        const el = doc.createElement('div');
        el.className = isPoint ? 'fx-hl fx-hl-point' : 'fx-hl';
        // Position highlights as PERCENTAGES of the page box, not fixed pixels,
        // so they stay pinned to their anchor when the page scales down to fit a
        // narrow screen (the box's pixel width is no longer viewport.width).
        if (isPoint) {
          // Anchor the marker by its CENTER and keep a fixed, tappable size (see
          // .fx-hl-point) via a translate — so it never shrinks away on a phone.
          el.style.left = `${((r.left + r.width / 2) / vw) * 100}%`;
          el.style.top = `${((r.top + r.height / 2) / vh) * 100}%`;
        } else {
          el.style.left = `${(r.left / vw) * 100}%`;
          el.style.top = `${(r.top / vh) * 100}%`;
          el.style.width = `${(r.width / vw) * 100}%`;
          el.style.height = `${(r.height / vh) * 100}%`;
          el.style.background = ann.color;
        }
        el.dataset['noteId'] = ann.id;
        el.addEventListener('click', () => this.focusNote(ann.id));
        frame.overlay.appendChild(el);
        els.push(el);
      }
      frame.highlights.set(ann.id, els);
    }
  }

  private async renderCards(frame: PageFrame): Promise<void> {
    const doc = this.container.ownerDocument;
    const inputs: CardInput[] = [];

    for (const ann of frame.annotations) {
      const card = doc.createElement('div');
      card.className = 'fx-card';
      card.dataset['noteId'] = ann.id;
      card.style.borderLeftColor = ann.color;

      const body = doc.createElement('div');
      body.className = 'fx-card-body';
      body.innerHTML = await renderNoteMarkdown(ann.bodyMarkdown);
      card.appendChild(body);

      if (ann.tags.length > 0) {
        const tags = doc.createElement('div');
        tags.className = 'fx-card-tags';
        for (const t of ann.tags) {
          const tag = doc.createElement('span');
          tag.className = 'fx-tag';
          tag.textContent = t;
          tags.appendChild(tag);
        }
        card.appendChild(tags);
      }

      card.addEventListener('click', () => this.scrollToAnchor(ann.id));
      frame.margin.appendChild(card);
      frame.cards.set(ann.id, card);

      inputs.push({
        id: ann.id,
        idealTop: anchorTopViewportY(frame.viewport, ann.anchor),
        height: card.getBoundingClientRect().height || 0,
      });
    }

    this.positionCards(frame, inputs);
  }

  private positionCards(frame: PageFrame, inputs: CardInput[]): void {
    const layout = layoutMarginCards(inputs, {
      gap: 12,
      availableHeight: frame.viewport.height,
    });
    for (const placed of layout.cards) {
      const card = frame.cards.get(placed.id);
      if (card) card.style.top = `${placed.top}px`;
    }
    // Grow the rail if notes overflow the page height, so none are clipped.
    frame.margin.style.minHeight = `${Math.max(frame.viewport.height, layout.contentHeight)}px`;
  }

  // --- bidirectional focus + navigation -----------------------------------

  /** Focus a note: highlight it, scroll its card into view. */
  focusNote(noteId: string, opts: { updateHash?: boolean } = {}): void {
    const frame = this.frames.find((f) => f.annotations.some((a) => a.id === noteId));
    if (!frame) return;
    void this.ensurePageLive(frame.pageIndex).then(() => {
      this.setActive(noteId);
      const card = frame.cards.get(noteId);
      card?.scrollIntoView({ block: 'nearest' });
      if (opts.updateHash !== false) this.updateHash(frame.pageIndex, noteId);
    });
  }

  /** Scroll the page so a note's anchor is visible, and mark it active. */
  scrollToAnchor(noteId: string): void {
    const frame = this.frames.find((f) => f.annotations.some((a) => a.id === noteId));
    if (!frame) return;
    const ann = frame.annotations.find((a) => a.id === noteId);
    if (!ann) return;
    const top = anchorTopViewportY(frame.viewport, ann.anchor);
    const pageTop = (frame.main.parentElement as HTMLElement).offsetTop;
    this.scroll.scrollTo?.({ top: pageTop + top - 40, behavior: 'smooth' });
    this.setActive(noteId);
    this.updateHash(frame.pageIndex, noteId);
  }

  private setActive(noteId: string): void {
    if (this.activeNoteId) {
      this.forEachNoteEl(this.activeNoteId, (el) => el.classList.remove('fx-active'));
    }
    this.activeNoteId = noteId;
    this.forEachNoteEl(noteId, (el) => el.classList.add('fx-active'));
  }

  private forEachNoteEl(noteId: string, fn: (el: HTMLElement) => void): void {
    for (const frame of this.frames) {
      const card = frame.cards.get(noteId);
      if (card) fn(card);
      const hls = frame.highlights.get(noteId);
      if (hls) for (const el of hls) fn(el);
    }
  }

  private scrollToPage(pageIndex: number): void {
    const frame = this.frames[pageIndex];
    if (!frame) return;
    const pageTop = (frame.main.parentElement as HTMLElement).offsetTop;
    this.scroll.scrollTo?.({ top: pageTop, behavior: 'auto' });
  }

  private async ensurePageLive(pageIndex: number): Promise<void> {
    if (!this.live.has(pageIndex)) await this.mountPage(pageIndex);
  }

  private updateHash(pageIndex: number, noteId: string): void {
    const hash = serializeDeepLink({ pageIndex, noteId });
    if (this.history?.replaceState) {
      this.history.replaceState(null, '', hash || ' ');
    } else if (this.location) {
      this.location.hash = hash;
    }
  }

  private onHashChange = (): void => {
    const link = parseDeepLink(this.location?.hash ?? '');
    if (link.noteId) this.focusNote(link.noteId, { updateHash: false });
    else if (link.pageIndex !== undefined) this.scrollToPage(link.pageIndex);
  };

  private updatePageInfo(): void {
    const range = this.visibleRange();
    const shown = this.visible.size ? pageLabel(range.first) : 1;
    this.pageInfo.textContent = `Page ${shown} of ${this.pdf.pageCount}`;
  }

  // --- environment accessors (narrow, so happy-dom/headless don't crash) ---

  private get window(): Window & typeof globalThis {
    return (this.container.ownerDocument.defaultView ??
      (globalThis as unknown)) as Window & typeof globalThis;
  }
  private get location(): Location | undefined {
    return this.window.location;
  }
  private get history(): History | undefined {
    return this.window.history;
  }

  /** Detach observers and listeners; release canvases. */
  dispose(): void {
    this.observer?.disconnect();
    this.window.removeEventListener?.('hashchange', this.onHashChange);
    for (const i of [...this.live]) this.unmountPage(i);
  }
}

function groupByPage(annotations: LoadedAnnotation[]): Map<number, LoadedAnnotation[]> {
  const map = new Map<number, LoadedAnnotation[]>();
  for (const ann of annotations) {
    const key = ann.anchor.pageIndex;
    const list = map.get(key);
    if (list) list.push(ann);
    else map.set(key, [ann]);
  }
  return map;
}
