import type { Annotation, DocumentMeta } from '../model/schema';
import { PdfDocument, type PageInfo } from '../pdf/document';
import type { Viewport } from '../pdf/transforms';
import { canvasBackingSize } from '../pdf/transforms';
import {
  anchorHighlightRects,
  anchorTopViewportY,
  layoutMarginCards,
  renderNoteMarkdown,
  type CardInput,
} from '../notes';
import type { LineRect } from '../pdf/selection';
import {
  listDocuments,
  listAnnotations,
  getPdfBytes,
  createAnnotation,
  deleteAnnotation,
  requestPersistentStorage,
} from '../storage/storage';
import { importPdfFile } from './import';
import { buildTextAnchor, buildRegionAnchor, buildPointAnchor } from './anchor';
import { buildAnnotation } from './build';
import { newUuid, nowIso } from './ids';
import { NoteSaveController, type SaveState } from './save-controller';
import { publishReader, backupProject, runPreflight } from './publish';
import { ensureAuthorStyles } from './styles';
import { downloadBytes } from './download';

/**
 * The authoring application controller (DOM).
 *
 * Ties the tested pure/storage modules into a working UI: a collection sidebar,
 * PDF import, per-page rendering with a live text layer for selection, note
 * creation (text/region/point), a margin editor with debounced drafts +
 * revision-safe commits, and publish/backup/export actions.
 *
 * All correctness-critical logic (anchors, revisions, projection, export) lives
 * in the tested modules; this file is orchestration + DOM wiring.
 */

const CSS_ZOOM = 1.35;

export class AuthorApp {
  private readonly doc: Document;
  private readonly root: HTMLElement;
  private sidebarList!: HTMLUListElement;
  private main!: HTMLElement;

  private documents: DocumentMeta[] = [];
  private activeDoc: DocumentMeta | null = null;
  private activePdf: PdfDocument | null = null;
  private annotations = new Map<string, Annotation>();
  private controllers = new Map<string, NoteSaveController>();
  private pageViewports: Viewport[] = [];
  private pageInfos: PageInfo[] = [];
  private dpr: number;

  constructor(container: HTMLElement) {
    this.doc = container.ownerDocument;
    this.dpr =
      (globalThis as { devicePixelRatio?: number }).devicePixelRatio && this.win.devicePixelRatio > 0
        ? this.win.devicePixelRatio
        : 1;
    ensureAuthorStyles(this.doc);
    this.root = this.el('div', 'fa-app');
    container.appendChild(this.root);
  }

  private get win(): Window & typeof globalThis {
    return (this.doc.defaultView ?? (globalThis as unknown)) as Window & typeof globalThis;
  }

  async init(): Promise<void> {
    await requestPersistentStorage();
    this.renderShell();
    await this.refreshCollection();
  }

  // --- shell --------------------------------------------------------------

  private renderShell(): void {
    const sidebar = this.el('aside', 'fa-sidebar');

    const brand = this.el('div', 'fa-brand');
    const h1 = this.el('h1');
    h1.textContent = 'Fermat';
    const tag = this.el('p');
    tag.textContent = 'Margin notes for PDFs — local & free';
    brand.append(h1, tag);

    const actions = this.el('div', 'fa-actions');
    const importBtn = this.button('Import PDF…', 'fa-btn fa-btn-primary');
    const fileInput = this.doc.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'application/pdf,.pdf';
    fileInput.multiple = true;
    fileInput.style.display = 'none';
    importBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => void this.onImportFiles(fileInput.files));

    actions.append(importBtn, fileInput);

    this.sidebarList = this.el('ul', 'fa-list') as HTMLUListElement;
    sidebar.append(brand, actions, this.sidebarList);

    this.main = this.el('div', 'fa-main');
    this.renderEmptyMain();

    this.root.append(sidebar, this.main);
  }

  private renderEmptyMain(): void {
    this.main.replaceChildren();
    const empty = this.el('div', 'fa-empty');
    empty.textContent = this.documents.length
      ? 'Select a document from the left, or import a new PDF.'
      : 'Import a PDF to begin. Everything stays in this browser until you export.';
    this.main.appendChild(empty);
  }

  // --- collection ---------------------------------------------------------

  private async refreshCollection(): Promise<void> {
    this.documents = (await listDocuments()).sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    );
    this.renderCollection();
  }

  private renderCollection(): void {
    this.sidebarList.replaceChildren();
    for (const d of this.documents) {
      const li = this.el('li', 'fa-doc') as HTMLLIElement;
      if (this.activeDoc?.id === d.id) li.classList.add('fa-selected');
      const title = this.el('span', 'fa-doc-title');
      title.textContent = d.title;
      const meta = this.el('span', 'fa-doc-meta');
      meta.textContent = `${d.pageCount} pages · ${d.readingStatus}`;
      li.append(title, meta);
      li.addEventListener('click', () => void this.openDocument(d));
      this.sidebarList.appendChild(li);
    }
  }

  private async onImportFiles(files: FileList | null): Promise<void> {
    if (!files || files.length === 0) return;
    let firstImported: DocumentMeta | null = null;
    for (const file of Array.from(files)) {
      try {
        const result = await importPdfFile(file);
        firstImported ??= result.document;
      } catch (err) {
        this.showError(`Could not import ${file.name}: ${message(err)}`);
      }
    }
    await this.refreshCollection();
    if (firstImported) await this.openDocument(firstImported);
  }

  // --- document view ------------------------------------------------------

  private async openDocument(meta: DocumentMeta): Promise<void> {
    await this.closeActive();
    this.activeDoc = meta;

    const bytes = await getPdfBytes(meta.id);
    if (!bytes) {
      this.showError('This document has no stored PDF bytes.');
      return;
    }
    // Point PDF.js at the locally-served bundled font + cmap assets (the same
    // ones prepare-viewer.mjs stages under public/viewer/assets), so standard-14
    // fonts and CJK render in the authoring canvas with no external fetch.
    const assetsBase = new URL('viewer/assets/', document.baseURI).href;
    this.activePdf = await PdfDocument.open(bytes, {
      standardFontDataUrl: `${assetsBase}standard_fonts/`,
      cMapUrl: `${assetsBase}cmaps/`,
    });

    const anns = await listAnnotations(meta.sha256);
    this.annotations = new Map(anns.map((a) => [a.id, a]));

    this.renderCollection();
    await this.renderDocumentView();
  }

  private async closeActive(): Promise<void> {
    for (const c of this.controllers.values()) c.dispose();
    this.controllers.clear();
    this.annotations.clear();
    this.pageViewports = [];
    this.pageInfos = [];
    if (this.activePdf) {
      await this.activePdf.close();
      this.activePdf = null;
    }
  }

  private async renderDocumentView(): Promise<void> {
    if (!this.activeDoc || !this.activePdf) return;
    const meta = this.activeDoc;
    const pdf = this.activePdf;

    this.main.replaceChildren();

    // Toolbar
    const toolbar = this.el('div', 'fa-toolbar');
    const name = this.el('span', 'fa-doc-name');
    name.textContent = meta.title;
    const spacer = this.el('div', 'fa-spacer');
    const publishBtn = this.button('Publish reader…', 'fa-btn fa-btn-primary');
    publishBtn.addEventListener('click', () => void this.onPublish());
    const backupBtn = this.button('Back up project', 'fa-btn');
    backupBtn.addEventListener('click', () => void this.onBackup());
    toolbar.append(name, spacer, publishBtn, backupBtn);
    this.main.appendChild(toolbar);

    const pages = this.el('div', 'fa-pages');
    this.main.appendChild(pages);

    this.pageViewports = [];
    this.pageInfos = [];
    for (let i = 0; i < pdf.pageCount; i++) {
      const info = await pdf.pageInfo(i);
      const viewport = await pdf.viewport(i, CSS_ZOOM);
      this.pageInfos.push(info);
      this.pageViewports.push(viewport);
      const pageEl = await this.renderPage(i, viewport);
      pages.appendChild(pageEl);
    }
  }

  private async renderPage(pageIndex: number, viewport: Viewport): Promise<HTMLElement> {
    const pdf = this.activePdf!;
    const pageEl = this.el('div', 'fa-page');

    const mainCol = this.el('div', 'fa-page-main');
    mainCol.style.width = `${viewport.width}px`;
    mainCol.style.height = `${viewport.height}px`;

    const canvas = this.doc.createElement('canvas');
    const { cssWidth, cssHeight } = canvasBackingSize(viewport, this.dpr);
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;
    mainCol.appendChild(canvas);
    await pdf.render(pageIndex, canvas, CSS_ZOOM, this.dpr);

    // Selectable text layer (transparent spans) for text-highlight selection.
    const textLayer = this.el('div', 'fa-textlayer');
    mainCol.appendChild(textLayer);
    try {
      await pdf.renderTextLayer(pageIndex, textLayer, CSS_ZOOM);
      this.wireTextSelection(mainCol, textLayer, pageIndex, viewport);
    } catch {
      // A page with no extractable text (e.g. scanned) simply has no text layer;
      // region/point notes still work.
    }

    const overlay = this.el('div', 'fa-overlay');
    mainCol.appendChild(overlay);

    // Region/point creation via drag/click on the overlay area.
    this.wirePageInput(mainCol, pageIndex, viewport);

    const margin = this.el('div', 'fa-margin');
    margin.style.minHeight = `${viewport.height}px`;

    pageEl.append(mainCol, margin);

    // Render existing annotations for this page.
    this.renderPageAnnotations(pageIndex, viewport, overlay, margin);

    return pageEl;
  }

  private pageAnnotations(pageIndex: number): Annotation[] {
    return [...this.annotations.values()].filter((a) => a.anchor.pageIndex === pageIndex);
  }

  private renderPageAnnotations(
    pageIndex: number,
    viewport: Viewport,
    overlay: HTMLElement,
    margin: HTMLElement,
  ): void {
    overlay.replaceChildren();
    margin.replaceChildren();

    const anns = this.pageAnnotations(pageIndex);
    const inputs: CardInput[] = [];

    for (const ann of anns) {
      // Highlights
      for (const r of anchorHighlightRects(viewport, ann.anchor)) {
        const hl = this.el('div', `fa-hl fa-${ann.publication}`);
        hl.style.left = `${r.left}px`;
        hl.style.top = `${r.top}px`;
        hl.style.width = `${r.width}px`;
        hl.style.height = `${r.height}px`;
        hl.style.background = ann.color;
        overlay.appendChild(hl);
      }
      // Editor card
      const card = this.buildEditorCard(ann, () =>
        this.renderPageAnnotations(pageIndex, viewport, overlay, margin),
      );
      margin.appendChild(card);
      inputs.push({
        id: ann.id,
        idealTop: anchorTopViewportY(viewport, ann.anchor),
        height: card.getBoundingClientRect().height || 120,
      });
    }

    const layout = layoutMarginCards(inputs, { gap: 12, availableHeight: viewport.height });
    for (const placed of layout.cards) {
      const card = margin.querySelector<HTMLElement>(`[data-note-id="${placed.id}"]`);
      if (card) card.style.top = `${placed.top}px`;
    }
    margin.style.minHeight = `${Math.max(viewport.height, layout.contentHeight)}px`;
  }

  private buildEditorCard(ann: Annotation, onChange: () => void): HTMLElement {
    const card = this.el('div', 'fa-card');
    card.dataset['noteId'] = ann.id;
    card.style.borderLeftColor = ann.color;

    const controller =
      this.controllers.get(ann.id) ??
      new NoteSaveController(ann, {
        documentId: this.activeDoc!.id,
        onState: (s) => this.reflectSaveState(card, s),
        onCommitted: (a) => {
          this.annotations.set(a.id, a);
        },
      });
    this.controllers.set(ann.id, controller);

    const state = this.el('span', 'fa-chip');
    state.dataset['role'] = 'state';
    this.reflectSaveState(card, controller.state, state);

    const textarea = this.doc.createElement('textarea');
    textarea.value = ann.bodyMarkdown;
    textarea.placeholder = 'Write a note in Markdown… ($math$ supported)';
    textarea.addEventListener('input', () => {
      controller.edit({ bodyMarkdown: textarea.value });
      void this.updatePreview(preview, textarea.value);
    });
    textarea.addEventListener('blur', () => void this.commit(controller));

    const preview = this.el('div', 'fa-preview');
    void this.updatePreview(preview, ann.bodyMarkdown);

    const row = this.el('div', 'fa-card-row');
    const tags = this.doc.createElement('input');
    tags.type = 'text';
    tags.placeholder = 'tags, comma-separated';
    tags.value = ann.tags.join(', ');
    tags.addEventListener('input', () =>
      controller.edit({ tags: splitTags(tags.value) }),
    );
    tags.addEventListener('blur', () => void this.commit(controller));

    const pub = this.el('label', 'fa-toggle') as HTMLLabelElement;
    const pubBox = this.doc.createElement('input');
    pubBox.type = 'checkbox';
    pubBox.checked = ann.publication === 'public';
    pubBox.addEventListener('change', () => {
      controller.edit({ publication: pubBox.checked ? 'public' : 'private' });
      void this.commit(controller).then(onChange);
    });
    pub.append(pubBox, this.doc.createTextNode('Public'));

    const del = this.button('Delete', 'fa-btn');
    del.addEventListener('click', () => void this.onDeleteNote(ann.id, onChange));

    row.append(tags, pub, del);

    const head = this.el('div', 'fa-card-row');
    head.append(state);
    card.append(head, textarea, preview, row);
    return card;
  }

  private async commit(controller: NoteSaveController): Promise<void> {
    try {
      await controller.commit();
    } catch {
      // State chip already reflects 'conflict'/'error'; nothing else to do here.
    }
  }

  private reflectSaveState(card: HTMLElement, s: SaveState, chip?: HTMLElement): void {
    const el = chip ?? card.querySelector<HTMLElement>('[data-role="state"]');
    if (!el) return;
    const map: Record<SaveState, [string, string]> = {
      idle: ['', 'Ready'],
      dirty: ['', 'Unsaved…'],
      saving: ['fa-chip-saving', 'Saving…'],
      saved: ['fa-chip-saved', 'Saved'],
      error: ['fa-chip-error', 'Save failed'],
      conflict: ['fa-chip-conflict', 'Changed elsewhere'],
    };
    const [cls, label] = map[s];
    el.className = `fa-chip ${cls}`.trim();
    el.textContent = label;
  }

  private async updatePreview(el: HTMLElement, md: string): Promise<void> {
    el.innerHTML = md.trim() ? await renderNoteMarkdown(md) : '';
  }

  private async onDeleteNote(id: string, onChange: () => void): Promise<void> {
    this.controllers.get(id)?.dispose();
    this.controllers.delete(id);
    await deleteAnnotation(id);
    this.annotations.delete(id);
    onChange();
  }

  // --- note creation ------------------------------------------------------

  private wirePageInput(mainCol: HTMLElement, pageIndex: number, viewport: Viewport): void {
    let startX = 0;
    let startY = 0;
    let dragging = false;
    let band: HTMLElement | null = null;

    const localPoint = (ev: MouseEvent): [number, number] => {
      const rect = mainCol.getBoundingClientRect();
      return [ev.clientX - rect.left, ev.clientY - rect.top];
    };

    mainCol.addEventListener('mousedown', (ev) => {
      // Left button on empty page area starts a region drag; text selection is
      // handled separately via the text layer + selection toolbar.
      if (ev.button !== 0 || (ev.target as HTMLElement).closest('.fa-hl')) return;
      [startX, startY] = localPoint(ev);
      dragging = true;
      band = this.el('div', 'fa-hl fa-private');
      band.style.left = `${startX}px`;
      band.style.top = `${startY}px`;
      band.style.background = 'rgba(43,108,176,0.15)';
      mainCol.querySelector('.fa-overlay')?.appendChild(band);
    });

    mainCol.addEventListener('mousemove', (ev) => {
      if (!dragging || !band) return;
      const [x, y] = localPoint(ev);
      band.style.left = `${Math.min(startX, x)}px`;
      band.style.top = `${Math.min(startY, y)}px`;
      band.style.width = `${Math.abs(x - startX)}px`;
      band.style.height = `${Math.abs(y - startY)}px`;
    });

    mainCol.addEventListener('mouseup', (ev) => {
      if (!dragging) return;
      dragging = false;
      const [x, y] = localPoint(ev);
      band?.remove();
      band = null;
      const w = Math.abs(x - startX);
      const h = Math.abs(y - startY);
      if (w < 6 && h < 6) {
        // Treat as a point note.
        void this.createNote(
          buildPointAnchor({ info: this.infoFor(pageIndex), viewport, x, y }),
          pageIndex,
        );
      } else {
        const rect: LineRect = {
          left: Math.min(startX, x),
          top: Math.min(startY, y),
          width: w,
          height: h,
        };
        void this.createNote(
          buildRegionAnchor({ info: this.infoFor(pageIndex), viewport, rect }),
          pageIndex,
        );
      }
    });
  }

  private wireTextSelection(
    mainCol: HTMLElement,
    textLayer: HTMLElement,
    pageIndex: number,
    viewport: Viewport,
  ): void {
    // On mouseup inside the text layer, if there is a non-empty selection within
    // this page, offer a "Highlight + note" action.
    textLayer.addEventListener('mouseup', () => {
      const sel = this.win.getSelection?.();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
        this.hideSelToolbar();
        return;
      }
      const range = sel.getRangeAt(0);
      // Only act if the selection is inside this page's text layer.
      if (!textLayer.contains(range.commonAncestorContainer)) return;

      const pageRect = mainCol.getBoundingClientRect();
      const lineRects: LineRect[] = [];
      for (const r of Array.from(range.getClientRects())) {
        lineRects.push({
          left: r.left - pageRect.left,
          top: r.top - pageRect.top,
          width: r.width,
          height: r.height,
        });
      }
      if (lineRects.length === 0) {
        this.hideSelToolbar();
        return;
      }
      const exact = sel.toString();
      this.showSelToolbar(range, () => {
        void this.createNote(
          buildTextAnchor({
            info: this.infoFor(pageIndex),
            viewport,
            rects: lineRects,
            quote: { exact, prefix: '', suffix: '' },
          }),
          pageIndex,
        );
        sel.removeAllRanges();
        this.hideSelToolbar();
      });
    });
  }

  private selToolbar: HTMLElement | null = null;
  private showSelToolbar(range: Range, onHighlight: () => void): void {
    this.hideSelToolbar();
    const bar = this.el('div', 'fa-seltoolbar');
    const btn = this.button('Highlight + note', '');
    btn.addEventListener('click', onHighlight);
    bar.appendChild(btn);
    this.doc.body.appendChild(bar);
    const rect = range.getBoundingClientRect();
    bar.style.display = 'flex';
    bar.style.left = `${rect.left + this.win.scrollX}px`;
    bar.style.top = `${rect.bottom + this.win.scrollY + 6}px`;
    this.selToolbar = bar;
  }
  private hideSelToolbar(): void {
    this.selToolbar?.remove();
    this.selToolbar = null;
  }

  private infoFor(pageIndex: number): PageInfo {
    // Use the canonical PageInfo captured at render time — it carries the real
    // CropBox-clipped viewBox, inherent rotation, and UserUnit, so anchors are
    // stored correctly for pages with offsets/rotation/non-unit UserUnit.
    return this.pageInfos[pageIndex]!;
  }

  private async createNote(anchor: ReturnType<typeof buildPointAnchor>, pageIndex: number): Promise<void> {
    if (!this.activeDoc) return;
    const ann = buildAnnotation({
      id: newUuid(),
      documentSha256: this.activeDoc.sha256,
      anchor,
      now: nowIso(),
    });
    try {
      await createAnnotation(ann);
      this.annotations.set(ann.id, ann);
      // Re-render just this page.
      const viewport = this.pageViewports[pageIndex]!;
      const pageEl = this.main.querySelectorAll('.fa-page')[pageIndex] as HTMLElement | undefined;
      const overlay = pageEl?.querySelector<HTMLElement>('.fa-overlay');
      const margin = pageEl?.querySelector<HTMLElement>('.fa-margin');
      if (overlay && margin) this.renderPageAnnotations(pageIndex, viewport, overlay, margin);
    } catch (err) {
      this.showError(`Could not create note: ${message(err)}`);
    }
  }

  // --- publish / backup ---------------------------------------------------

  private async onPublish(): Promise<void> {
    if (!this.activeDoc) return;
    try {
      const report = await runPreflight(this.activeDoc);
      if (!report.hasPublishable) {
        this.showError('No notes are marked public. Toggle "Public" on the notes to include.');
        return;
      }
      if (report.requiresAcknowledgement) {
        const ok = this.win.confirm?.(report.warnings.join('\n\n') + '\n\nContinue with export?');
        if (!ok) return;
      }
      const result = await publishReader(this.activeDoc);
      downloadBytes(this.doc, result.zip, `${safeName(this.activeDoc.title)}-reader.zip`);
    } catch (err) {
      this.showError(`Publish failed: ${message(err)}`);
    }
  }

  private async onBackup(): Promise<void> {
    if (!this.activeDoc) return;
    try {
      const zip = await backupProject(this.activeDoc);
      downloadBytes(this.doc, zip, `${safeName(this.activeDoc.title)}-project.zip`);
    } catch (err) {
      this.showError(`Backup failed: ${message(err)}`);
    }
  }

  // --- helpers ------------------------------------------------------------

  private showError(msg: string): void {
    const banner = this.el('div', 'fa-error-banner');
    banner.textContent = msg;
    this.main.insertBefore(banner, this.main.firstChild);
    this.win.setTimeout?.(() => banner.remove(), 6000);
  }

  private el(tag: string, className?: string): HTMLElement {
    const e = this.doc.createElement(tag);
    if (className) e.className = className;
    return e;
  }
  private button(label: string, className: string): HTMLButtonElement {
    const b = this.doc.createElement('button');
    b.className = className;
    b.textContent = label;
    b.type = 'button';
    return b;
  }
}

function splitTags(value: string): string[] {
  return value
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function safeName(title: string): string {
  return title.replace(/[^a-z0-9-_]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'reading';
}
