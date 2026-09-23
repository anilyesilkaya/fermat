import type { Annotation, Anchor, DocumentMeta } from '../model/schema';
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
import {
  TOOLS,
  DEFAULT_TOOL,
  toolMeta,
  armedGesture,
  isToolAvailable,
  toolForShortcut,
  type AuthorTool,
} from './tool';

/**
 * The authoring application controller (DOM).
 *
 * Ties the tested pure/storage modules into a working UI: a collection sidebar,
 * PDF import, per-page rendering with a live text layer for selection, note
 * creation (text/region/point) driven by an explicit tool (see ./tool), a
 * margin editor with debounced drafts + revision-safe commits, and
 * publish/backup/export actions.
 *
 * All correctness-critical logic (anchors, revisions, projection, export) lives
 * in the tested modules; this file is orchestration + DOM wiring. The choice of
 * which gesture creates which note kind is delegated to the pure tool model, so
 * this layer only asks "what gesture is armed?" and never guesses from geometry.
 */

const CSS_ZOOM = 1.35;

/** Preset note colors offered in the editor (first is the default). */
const NOTE_COLORS = ['#ffe066', '#8ce99a', '#74c0fc', '#ffa8a8', '#e599f7'] as const;

/** Light/dark chrome theme. The PDF page itself always stays white paper. */
type Theme = 'light' | 'dark';
const THEME_STORAGE_KEY = 'fermat-author-theme';

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
  private pageHasText: boolean[] = [];
  private dpr: number;

  /** The active authoring tool; decides which gesture creates which note kind. */
  private tool: AuthorTool = DEFAULT_TOOL;
  /** Color applied to the next created note (last color the author picked). */
  private lastColor: string = NOTE_COLORS[0];
  /** Id of the most recently created note, for single-level undo. */
  private lastCreatedId: string | null = null;
  /** Toolbar tool buttons, kept for active/disabled state updates. */
  private toolButtons = new Map<AuthorTool, HTMLButtonElement>();
  private hintBar: HTMLElement | null = null;
  private keyHandler: ((ev: KeyboardEvent) => void) | null = null;
  private theme: Theme = 'light';
  private themeButton: HTMLButtonElement | null = null;

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
    this.applyTheme(this.initialTheme(), { persist: false });
    this.installKeyboard();
    await this.refreshCollection();
  }

  // --- theme --------------------------------------------------------------

  /** Persisted choice, else the OS preference, else light. */
  private initialTheme(): Theme {
    const stored = this.readStoredTheme();
    if (stored) return stored;
    const mql = this.win.matchMedia?.('(prefers-color-scheme: dark)');
    return mql?.matches ? 'dark' : 'light';
  }

  private readStoredTheme(): Theme | null {
    try {
      const v = this.win.localStorage?.getItem(THEME_STORAGE_KEY);
      return v === 'dark' || v === 'light' ? v : null;
    } catch {
      return null; // storage may be unavailable (private mode / file://).
    }
  }

  private toggleTheme(): void {
    this.applyTheme(this.theme === 'dark' ? 'light' : 'dark', { persist: true });
  }

  private applyTheme(theme: Theme, opts: { persist: boolean }): void {
    this.theme = theme;
    this.root.dataset['theme'] = theme;
    if (this.themeButton) {
      // Label offers the OTHER theme (the action taken on click).
      const toDark = theme === 'light';
      this.themeButton.textContent = toDark ? '🌙 Dark' : '☀ Light';
      this.themeButton.title = toDark ? 'Switch to dark theme' : 'Switch to light theme';
      this.themeButton.setAttribute('aria-pressed', theme === 'dark' ? 'true' : 'false');
    }
    if (opts.persist) {
      try {
        this.win.localStorage?.setItem(THEME_STORAGE_KEY, theme);
      } catch {
        // Ignore storage failures — the theme still applies for this session.
      }
    }
  }

  // --- shell --------------------------------------------------------------

  private renderShell(): void {
    const sidebar = this.el('aside', 'fa-sidebar');

    const brand = this.el('div', 'fa-brand');
    const brandText = this.el('div', 'fa-brand-text');
    const h1 = this.el('h1');
    h1.textContent = 'Fermat';
    const tag = this.el('p');
    tag.textContent = 'Margin notes for PDFs — local & free';
    brandText.append(h1, tag);
    const themeBtn = this.button('', 'fa-btn fa-theme-btn');
    themeBtn.addEventListener('click', () => this.toggleTheme());
    this.themeButton = themeBtn;
    brand.append(brandText, themeBtn);

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

  /** Return to the collection: close the open document and show the shelf. */
  private async goHome(): Promise<void> {
    await this.closeActive();
    this.activeDoc = null;
    this.hintBar = null;
    this.renderCollection();
    this.renderEmptyMain();
  }

  private async renderDocumentView(): Promise<void> {
    if (!this.activeDoc || !this.activePdf) return;
    const meta = this.activeDoc;
    const pdf = this.activePdf;

    this.main.replaceChildren();

    // Toolbar
    const toolbar = this.el('div', 'fa-toolbar');
    const homeBtn = this.button('← Home', 'fa-btn');
    homeBtn.title = 'Back to the collection';
    homeBtn.addEventListener('click', () => void this.goHome());
    const name = this.el('span', 'fa-doc-name');
    name.textContent = meta.title;
    const tools = this.buildToolGroup();
    const spacer = this.el('div', 'fa-spacer');
    const publishBtn = this.button('Publish reader…', 'fa-btn fa-btn-primary');
    publishBtn.addEventListener('click', () => void this.onPublish());
    const backupBtn = this.button('Back up project', 'fa-btn');
    backupBtn.addEventListener('click', () => void this.onBackup());
    toolbar.append(homeBtn, name, tools, spacer, publishBtn, backupBtn);
    this.main.appendChild(toolbar);

    // Active-tool hint bar.
    this.hintBar = this.el('div', 'fa-hint');
    this.main.appendChild(this.hintBar);

    const pages = this.el('div', 'fa-pages');
    this.main.appendChild(pages);

    this.pageViewports = [];
    this.pageInfos = [];
    this.pageHasText = [];
    this.toolButtons.clear();
    this.tool = DEFAULT_TOOL;
    for (let i = 0; i < pdf.pageCount; i++) {
      const info = await pdf.pageInfo(i);
      const viewport = await pdf.viewport(i, CSS_ZOOM);
      this.pageInfos.push(info);
      this.pageViewports.push(viewport);
      this.pageHasText.push(false);
      const pageEl = await this.renderPage(i, viewport);
      pages.appendChild(pageEl);
    }
    // Rebuild the tool group now that we know whether ANY page has selectable
    // text — Highlight is disabled for text-free (e.g. scanned) documents.
    this.refreshToolGroup();
    this.setTool(this.tool);
  }

  private get anyPageHasText(): boolean {
    return this.pageHasText.some(Boolean);
  }

  // --- tools --------------------------------------------------------------

  private buildToolGroup(): HTMLElement {
    const group = this.el('div', 'fa-tools');
    group.setAttribute('role', 'toolbar');
    group.setAttribute('aria-label', 'Annotation tools');
    this.toolButtons.clear();
    for (const meta of TOOLS) {
      const btn = this.button(meta.label, 'fa-tool');
      btn.dataset['tool'] = meta.tool;
      btn.title = `${meta.label} (${meta.shortcut.toUpperCase()}) — ${meta.hint}`;
      btn.setAttribute('aria-pressed', 'false');
      btn.addEventListener('click', () => this.setTool(meta.tool));
      this.toolButtons.set(meta.tool, btn);
      group.appendChild(btn);
    }
    return group;
  }

  /** Reflect text-layer availability onto the tool buttons (disable Highlight). */
  private refreshToolGroup(): void {
    const hasText = this.anyPageHasText;
    for (const meta of TOOLS) {
      const btn = this.toolButtons.get(meta.tool);
      if (!btn) continue;
      const available = isToolAvailable(meta.tool, hasText);
      btn.disabled = !available;
      btn.title = available
        ? `${meta.label} (${meta.shortcut.toUpperCase()}) — ${meta.hint}`
        : `${meta.label} unavailable — this PDF has no selectable text. Use Box or Pin.`;
    }
  }

  /** Activate a tool: update button state, page cursor, text-layer gating, hint. */
  private setTool(tool: AuthorTool): void {
    // Never activate a tool that isn't available on this document.
    if (!isToolAvailable(tool, this.anyPageHasText)) return;
    this.tool = tool;
    for (const [t, btn] of this.toolButtons) {
      const active = t === tool;
      btn.classList.toggle('fa-tool-active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
    // A single class on the main pane drives cursor + text-layer interactivity
    // (see styles): only the Highlight tool lets the text layer take the pointer.
    for (const t of TOOLS) this.main.classList.remove(`fa-tool-${t.tool}`);
    this.main.classList.add(`fa-tool-${tool}`);
    this.main.style.setProperty('--fa-page-cursor', toolMeta(tool).cursor);
    if (this.hintBar) this.hintBar.textContent = toolMeta(tool).hint;
  }

  /** Global keyboard shortcuts for tool switching and undo (ignored in fields). */
  private installKeyboard(): void {
    if (this.keyHandler) return;
    this.keyHandler = (ev: KeyboardEvent): void => {
      if (!this.activeDoc) return;
      const target = ev.target as HTMLElement | null;
      const inField =
        !!target &&
        (target.tagName === 'TEXTAREA' ||
          target.tagName === 'INPUT' ||
          target.isContentEditable);
      if (inField) return;
      if ((ev.ctrlKey || ev.metaKey) && !ev.shiftKey && ev.key.toLowerCase() === 'z') {
        ev.preventDefault();
        void this.undoLastNote();
        return;
      }
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
      const tool = toolForShortcut(ev.key);
      if (tool) {
        ev.preventDefault();
        this.setTool(tool);
      }
    };
    this.win.addEventListener?.('keydown', this.keyHandler);
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
      this.pageHasText[pageIndex] = textLayer.childNodes.length > 0;
      this.wireTextSelection(mainCol, textLayer, pageIndex, viewport);
    } catch {
      // A page with no extractable text (e.g. scanned) simply has no text layer;
      // region/point notes still work. `pageHasText[pageIndex]` stays false.
    }

    const overlay = this.el('div', 'fa-overlay');
    mainCol.appendChild(overlay);

    // Region (Box) / point (Pin) creation on the page surface. The handlers are
    // gated on the active tool, so nothing fires unless Box/Pin is selected.
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
      const isPoint = ann.anchor.kind === 'point';
      for (const r of anchorHighlightRects(viewport, ann.anchor)) {
        const hl = this.el('div', `fa-hl fa-${ann.publication}${isPoint ? ' fa-hl-point' : ''}`);
        hl.dataset['noteId'] = ann.id;
        hl.style.left = `${r.left}px`;
        hl.style.top = `${r.top}px`;
        hl.style.width = `${r.width}px`;
        hl.style.height = `${r.height}px`;
        if (!isPoint) hl.style.background = ann.color;
        hl.addEventListener('click', () => this.focusNoteCard(ann.id));
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

    const colors = this.buildColorRow(ann, controller, card, onChange);

    const head = this.el('div', 'fa-card-row');
    head.append(state);
    card.append(head, textarea, preview, colors, row);
    return card;
  }

  /** A swatch row + custom picker that sets a note's color live. */
  private buildColorRow(
    ann: Annotation,
    controller: NoteSaveController,
    card: HTMLElement,
    onChange: () => void,
  ): HTMLElement {
    const wrap = this.el('div', 'fa-colors');
    const apply = (color: string): void => {
      this.lastColor = color;
      controller.edit({ color });
      card.style.borderLeftColor = color;
      // Recolor this note's highlights immediately.
      const sel = `.fa-hl[data-note-id="${cssEscape(ann.id)}"]`;
      for (const hl of Array.from(this.main.querySelectorAll<HTMLElement>(sel))) {
        if (ann.anchor.kind !== 'point') hl.style.background = color;
      }
      void this.commit(controller).then(onChange);
    };
    for (const color of NOTE_COLORS) {
      const sw = this.el('button', 'fa-swatch') as HTMLButtonElement;
      sw.type = 'button';
      sw.style.background = color;
      sw.title = color;
      sw.setAttribute('aria-label', `Set color ${color}`);
      if (color.toLowerCase() === ann.color.toLowerCase()) sw.classList.add('fa-swatch-active');
      sw.addEventListener('click', () => {
        for (const s of Array.from(wrap.querySelectorAll('.fa-swatch'))) {
          s.classList.remove('fa-swatch-active');
        }
        sw.classList.add('fa-swatch-active');
        apply(color);
      });
      wrap.appendChild(sw);
    }
    const custom = this.doc.createElement('input') as HTMLInputElement;
    custom.type = 'color';
    custom.className = 'fa-color-input';
    custom.value = ann.color;
    custom.title = 'Custom color';
    custom.addEventListener('input', () => {
      for (const s of Array.from(wrap.querySelectorAll('.fa-swatch'))) {
        s.classList.remove('fa-swatch-active');
      }
      apply(custom.value);
    });
    wrap.appendChild(custom);
    return wrap;
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
    await this.removeNote(id);
    onChange();
  }

  // --- note creation ------------------------------------------------------

  private wirePageInput(mainCol: HTMLElement, pageIndex: number, viewport: Viewport): void {
    let startX = 0;
    let startY = 0;
    let dragging = false;
    let band: HTMLElement | null = null;
    // Track the pointer globally during a drag so a rectangle finished off the
    // page still resolves (R2 in the plan), and remove the listeners after.
    let onMove: ((ev: PointerEvent) => void) | null = null;
    let onUp: ((ev: PointerEvent) => void) | null = null;

    const localPoint = (ev: PointerEvent): [number, number] => {
      const rect = mainCol.getBoundingClientRect();
      return [ev.clientX - rect.left, ev.clientY - rect.top];
    };
    const clampToPage = (v: number, max: number): number => Math.max(0, Math.min(v, max));

    const endDrag = (): void => {
      dragging = false;
      band?.remove();
      band = null;
      if (onMove) this.doc.removeEventListener('pointermove', onMove);
      if (onUp) this.doc.removeEventListener('pointerup', onUp);
      onMove = null;
      onUp = null;
    };

    mainCol.addEventListener('pointerdown', (ev) => {
      const gesture = armedGesture(this.tool, this.pageHasText[pageIndex] ?? false);
      // Only the primary button, and never when starting on an existing
      // highlight (that is a Select-mode focus click, handled elsewhere).
      if (ev.button !== 0 || (ev.target as HTMLElement).closest('.fa-hl')) return;

      if (gesture === 'click-point') {
        const [px, py] = localPoint(ev);
        void this.createNote(
          buildPointAnchor({ info: this.infoFor(pageIndex), viewport, x: px, y: py }),
          pageIndex,
        );
        return;
      }
      if (gesture !== 'drag-region') return;

      // Box tool: rubber-band a rectangle.
      [startX, startY] = localPoint(ev);
      dragging = true;
      band = this.el('div', 'fa-hl fa-private fa-band');
      band.style.left = `${startX}px`;
      band.style.top = `${startY}px`;
      mainCol.querySelector('.fa-overlay')?.appendChild(band);

      onMove = (mv: PointerEvent): void => {
        if (!dragging || !band) return;
        const [x, y] = localPoint(mv);
        band.style.left = `${Math.min(startX, x)}px`;
        band.style.top = `${Math.min(startY, y)}px`;
        band.style.width = `${Math.abs(x - startX)}px`;
        band.style.height = `${Math.abs(y - startY)}px`;
      };
      onUp = (up: PointerEvent): void => {
        if (!dragging) return;
        const [rawX, rawY] = localPoint(up);
        const x = clampToPage(rawX, viewport.width);
        const y = clampToPage(rawY, viewport.height);
        endDrag();
        const w = Math.abs(x - startX);
        const h = Math.abs(y - startY);
        // A too-small box is a slip, not a note — ignore it (no accidental notes).
        if (w < 6 || h < 6) return;
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
      };
      this.doc.addEventListener('pointermove', onMove);
      this.doc.addEventListener('pointerup', onUp);
    });
  }

  private wireTextSelection(
    mainCol: HTMLElement,
    textLayer: HTMLElement,
    pageIndex: number,
    viewport: Viewport,
  ): void {
    // On mouseup inside the text layer, if there is a non-empty selection within
    // this page, offer a "Highlight + note" action — but ONLY when the Highlight
    // tool is active, so text selection never fires alongside Box/Pin/Select.
    textLayer.addEventListener('mouseup', () => {
      if (armedGesture(this.tool, this.pageHasText[pageIndex] ?? false) !== 'text-selection') {
        return;
      }
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

  private async createNote(anchor: Anchor, pageIndex: number): Promise<void> {
    if (!this.activeDoc) return;
    const ann = buildAnnotation({
      id: newUuid(),
      documentSha256: this.activeDoc.sha256,
      anchor,
      color: this.lastColor,
      now: nowIso(),
    });
    try {
      await createAnnotation(ann);
      this.annotations.set(ann.id, ann);
      this.lastCreatedId = ann.id;
      // Re-render just this page.
      const viewport = this.pageViewports[pageIndex]!;
      const pageEl = this.main.querySelectorAll('.fa-page')[pageIndex] as HTMLElement | undefined;
      const overlay = pageEl?.querySelector<HTMLElement>('.fa-overlay');
      const margin = pageEl?.querySelector<HTMLElement>('.fa-margin');
      if (overlay && margin) this.renderPageAnnotations(pageIndex, viewport, overlay, margin);
      this.flashNote(ann.id);
    } catch (err) {
      this.showError(`Could not create note: ${message(err)}`);
    }
  }

  /** Scroll a note's card into view and mark it active (Select-mode click). */
  private focusNoteCard(id: string): void {
    const safe = cssEscape(id);
    const card = this.main.querySelector<HTMLElement>(`.fa-card[data-note-id="${safe}"]`);
    if (!card) return;
    for (const c of Array.from(this.main.querySelectorAll('.fa-card.fa-active'))) {
      c.classList.remove('fa-active');
    }
    card.classList.add('fa-active');
    card.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }

  /** Briefly flash a note's highlight + card so the author sees what appeared. */
  private flashNote(id: string): void {
    const sel = `[data-note-id="${cssEscape(id)}"]`;
    for (const el of Array.from(this.main.querySelectorAll<HTMLElement>(sel))) {
      el.classList.remove('fa-flash');
      // Force reflow so re-adding the class restarts the animation.
      void el.offsetWidth;
      el.classList.add('fa-flash');
      this.win.setTimeout?.(() => el.classList.remove('fa-flash'), 700);
    }
  }

  /** Delete the most recently created note (single-level undo). */
  private async undoLastNote(): Promise<void> {
    const id = this.lastCreatedId;
    if (!id || !this.annotations.has(id)) return;
    const pageIndex = this.annotations.get(id)!.anchor.pageIndex;
    this.lastCreatedId = null;
    await this.removeNote(id);
    this.rerenderPage(pageIndex);
  }

  /** Tear down a note's controller + storage + in-memory entry. */
  private async removeNote(id: string): Promise<void> {
    this.controllers.get(id)?.dispose();
    this.controllers.delete(id);
    await deleteAnnotation(id);
    this.annotations.delete(id);
    if (this.lastCreatedId === id) this.lastCreatedId = null;
  }

  /** Re-render the annotations of a single page from current state. */
  private rerenderPage(pageIndex: number): void {
    const viewport = this.pageViewports[pageIndex];
    const pageEl = this.main.querySelectorAll('.fa-page')[pageIndex] as HTMLElement | undefined;
    const overlay = pageEl?.querySelector<HTMLElement>('.fa-overlay');
    const margin = pageEl?.querySelector<HTMLElement>('.fa-margin');
    if (viewport && overlay && margin) {
      this.renderPageAnnotations(pageIndex, viewport, overlay, margin);
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

/** CSS.escape when available, else identity (UUIDs need no escaping anyway). */
function cssEscape(id: string): string {
  const c = (globalThis as { CSS?: { escape?: (s: string) => string } }).CSS;
  return c?.escape ? c.escape(id) : id;
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
