/**
 * Author-app styles, injected as one <style> element.
 *
 * The authoring UI is a two-pane layout: a collection sidebar (the "bookshelf")
 * on the left and the active document — PDF pages with a margin note rail — on
 * the right. It shares the reader's spread/margin idea but adds authoring
 * affordances (selection toolbar, note editor, save-state chips).
 */

export const AUTHOR_STYLE_ID = 'fermat-author-styles';

export const AUTHOR_CSS = `
* , *::before, *::after { box-sizing: border-box; }
body { margin: 0; }

.fa-app {
  --fa-accent: #2b6cb0;
  --fa-border: #e2e8f0;
  --fa-muted: #718096;
  /* Chrome palette (light). The [data-theme="dark"] block below overrides these.
     The PDF page (.fa-page-main) intentionally stays white "paper" in both. */
  --fa-fg: #1a202c;
  --fa-panel: #ffffff;
  --fa-sidebar-bg: #fafbfc;
  --fa-pages-bg: #f5f6f8;
  --fa-hover: #edf2f7;
  --fa-selected: #e6f0fb;
  --fa-hint-bg: #fbfcfe;
  --fa-input-bg: #ffffff;
  --fa-card-left: #cbd5e0;
  color-scheme: light;
  color: var(--fa-fg);
  background: var(--fa-panel);
  font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  height: 100vh;
  display: grid;
  grid-template-columns: 300px 1fr;
}
.fa-app[data-theme="dark"] {
  --fa-accent: #5b8fd0;
  --fa-border: #31323d;
  --fa-muted: #9aa0ac;
  --fa-fg: #e6e7ea;
  --fa-panel: #20212a;
  --fa-sidebar-bg: #1a1b22;
  --fa-pages-bg: #16171b;
  --fa-hover: #2b2d38;
  --fa-selected: #2a3444;
  --fa-hint-bg: #1a1b22;
  --fa-input-bg: #171820;
  --fa-card-left: #3a3c48;
  color-scheme: dark;
}

.fa-sidebar {
  border-right: 1px solid var(--fa-border);
  background: var(--fa-sidebar-bg);
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.fa-brand { padding: 14px 16px; border-bottom: 1px solid var(--fa-border); display: flex; align-items: flex-start; gap: 8px; }
.fa-brand-text { flex: 1 1 auto; min-width: 0; }
.fa-brand h1 { font-size: 1.1rem; margin: 0; }
.fa-brand p { margin: 2px 0 0; color: var(--fa-muted); font-size: 0.8rem; }
.fa-theme-btn {
  flex: 0 0 auto; text-align: center; padding: 5px 9px; font-size: 0.78rem;
  line-height: 1; white-space: nowrap; align-self: center;
}

.fa-actions { padding: 12px 16px; display: flex; flex-direction: column; gap: 8px; border-bottom: 1px solid var(--fa-border); }
.fa-btn {
  appearance: none;
  border: 1px solid var(--fa-border);
  background: var(--fa-input-bg);
  color: var(--fa-fg);
  border-radius: 6px;
  padding: 7px 12px;
  font: inherit;
  cursor: pointer;
  text-align: left;
}
.fa-btn:hover { border-color: var(--fa-accent); }
.fa-btn-primary { background: var(--fa-accent); color: #fff; border-color: var(--fa-accent); }
.fa-btn:disabled { opacity: 0.5; cursor: default; }

.fa-list { list-style: none; margin: 0; padding: 6px; overflow: auto; flex: 1 1 auto; }
.fa-doc { padding: 9px 10px; border-radius: 6px; cursor: pointer; display: flex; flex-direction: column; gap: 2px; }
.fa-doc:hover { background: var(--fa-hover); }
.fa-doc.fa-selected { background: var(--fa-selected); outline: 1px solid var(--fa-accent); }
.fa-doc-title { font-weight: 600; font-size: 0.92rem; }
.fa-doc-meta { color: var(--fa-muted); font-size: 0.76rem; }

.fa-main { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.fa-toolbar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--fa-border);
  background: var(--fa-panel);
}
.fa-doc-name { font-weight: 600; }
.fa-spacer { flex: 1 1 auto; }

/* Tool group (segmented control). */
.fa-tools { display: inline-flex; border: 1px solid var(--fa-border); border-radius: 8px; overflow: hidden; margin-left: 6px; }
.fa-tool {
  appearance: none; border: 0; border-left: 1px solid var(--fa-border);
  background: var(--fa-input-bg); font: inherit; padding: 6px 12px; cursor: pointer; color: var(--fa-fg);
}
.fa-tool:first-child { border-left: 0; }
.fa-tool:hover:not(:disabled) { background: var(--fa-hover); }
.fa-tool-active { background: var(--fa-accent); color: #fff; }
.fa-tool-active:hover:not(:disabled) { background: var(--fa-accent); }
.fa-tool:disabled { opacity: 0.4; cursor: not-allowed; }

/* Active-tool hint bar. */
.fa-hint {
  flex: 0 0 auto; padding: 5px 14px; font-size: 0.8rem; color: var(--fa-muted);
  background: var(--fa-hint-bg); border-bottom: 1px solid var(--fa-border);
}
.fa-chip { font-size: 0.76rem; padding: 2px 9px; border-radius: 10px; background: #edf2f7; color: #4a5568; }
.fa-chip-saved { background: #e6ffed; color: #22543d; }
.fa-chip-saving { background: #fffbe6; color: #744210; }
.fa-chip-error { background: #fff5f5; color: #822727; }
.fa-chip-conflict { background: #fef0ff; color: #702459; }

.fa-pages { flex: 1 1 auto; overflow: auto; padding: 20px; background: var(--fa-pages-bg); }
.fa-page { display: flex; gap: 20px; align-items: flex-start; margin: 0 auto 20px; width: max-content; }
/* The page is always white "paper" regardless of theme — the PDF raster can't be
   recolored and highlights blend against white via mix-blend-mode:multiply. */
.fa-page-main { position: relative; background: #fff; box-shadow: 0 1px 4px rgba(0,0,0,0.15); cursor: var(--fa-page-cursor, default); }
.fa-textlayer {
  position: absolute; inset: 0; overflow: hidden; opacity: 0.2; line-height: 1;
  /* Only the Highlight tool routes the pointer to the text layer for selection;
     otherwise the layer is transparent to pointer events so Box/Pin/Select act
     on the page surface directly (this is what keeps gestures unambiguous). */
  pointer-events: none;
}
.fa-tool-highlight .fa-textlayer { pointer-events: auto; }
.fa-textlayer span { position: absolute; white-space: pre; color: transparent; cursor: text; transform-origin: 0 0; }
.fa-overlay { position: absolute; inset: 0; pointer-events: none; }
.fa-hl { position: absolute; pointer-events: auto; cursor: pointer; border-radius: 2px; mix-blend-mode: multiply; }
.fa-hl.fa-private { outline: 1px dashed rgba(0,0,0,0.4); }
.fa-hl.fa-public { outline: 2px solid var(--fa-accent); }
/* Point marker: a small pin dot rather than a filled box. */
.fa-hl.fa-hl-point {
  mix-blend-mode: normal; border-radius: 50%;
  background: var(--fa-accent); border: 2px solid #fff; box-shadow: 0 0 0 1px var(--fa-accent);
}
/* Rubber-band while dragging a Box. */
.fa-hl.fa-band { mix-blend-mode: normal; background: rgba(43,108,176,0.15); pointer-events: none; }
/* Creation flash for a freshly added note (highlight or card). */
.fa-flash { animation: fa-flash 0.7s ease-out; }
@keyframes fa-flash {
  0% { box-shadow: 0 0 0 3px var(--fa-accent); }
  100% { box-shadow: 0 0 0 0 rgba(43,108,176,0); }
}

.fa-margin { flex: 0 0 320px; position: relative; }
.fa-card { position: absolute; left: 0; width: 100%; background: var(--fa-panel); color: var(--fa-fg); border: 1px solid var(--fa-border); border-left: 4px solid var(--fa-card-left); border-radius: 6px; padding: 8px 10px; }
.fa-card.fa-active { border-left-color: var(--fa-accent); box-shadow: 0 0 0 2px var(--fa-accent); }
.fa-card textarea { width: 100%; min-height: 70px; font: inherit; background: var(--fa-input-bg); color: var(--fa-fg); border: 1px solid var(--fa-border); border-radius: 4px; padding: 6px; resize: vertical; }
.fa-card-row { display: flex; gap: 6px; align-items: center; margin-top: 6px; }
.fa-card-row input[type=text] { flex: 1 1 auto; font: inherit; background: var(--fa-input-bg); color: var(--fa-fg); border: 1px solid var(--fa-border); border-radius: 4px; padding: 4px 6px; }
.fa-toggle { font-size: 0.78rem; display: flex; align-items: center; gap: 4px; }
.fa-preview { font-size: 0.9rem; border-top: 1px dashed var(--fa-border); margin-top: 6px; padding-top: 6px; }

/* Per-note color: preset swatches + a custom picker. */
.fa-colors { display: flex; gap: 5px; align-items: center; margin-top: 6px; }
.fa-swatch {
  width: 18px; height: 18px; border-radius: 50%; border: 1px solid rgba(0,0,0,0.2);
  padding: 0; cursor: pointer; appearance: none;
}
.fa-swatch-active { outline: 2px solid var(--fa-accent); outline-offset: 1px; }
.fa-color-input {
  width: 24px; height: 22px; padding: 0; border: 1px solid var(--fa-border);
  border-radius: 4px; background: none; cursor: pointer; margin-left: 2px;
}

.fa-seltoolbar {
  position: fixed; z-index: 20; display: none; gap: 4px; padding: 4px;
  background: #1a202c; border-radius: 6px; box-shadow: 0 2px 8px rgba(0,0,0,0.3);
}
.fa-seltoolbar button { background: #2d3748; color: #fff; border: 0; border-radius: 4px; padding: 4px 8px; font: inherit; cursor: pointer; }
.fa-seltoolbar button:hover { background: var(--fa-accent); }

.fa-empty { margin: auto; color: var(--fa-muted); text-align: center; padding: 40px; }
.fa-banner { padding: 8px 14px; background: #fffbe6; color: #744210; border-bottom: 1px solid #f6e05e; font-size: 0.85rem; }
.fa-error-banner { padding: 8px 14px; background: #fff5f5; color: #822727; border-bottom: 1px solid #feb2b2; font-size: 0.85rem; }

/* Narrow screens (phones/tablets): the two-pane grid can't fit, so stack the
   collection sidebar above the document and let the toolbar wrap. The PDF page
   itself keeps its natural pixel size — authoring gestures map 1:1 to page
   pixels, so scaling it down would misplace Box/Pin notes — but the note rail
   moves BELOW the page (cards in reading order) instead of into a fixed side
   rail that would sit off-screen. The pages area scrolls if a page is wider
   than the viewport. */
@media (max-width: 720px) {
  .fa-app {
    grid-template-columns: 1fr;
    grid-template-rows: auto minmax(0, 1fr);
  }
  .fa-sidebar {
    border-right: 0;
    border-bottom: 1px solid var(--fa-border);
    max-height: 42vh;
  }
  .fa-toolbar { flex-wrap: wrap; gap: 6px; }
  .fa-tools { margin-left: 0; }
  .fa-page { flex-direction: column; width: auto; }
  .fa-margin { flex: 0 0 auto; width: 100%; max-width: 640px; min-height: 0 !important; }
  .fa-card { position: static; width: 100%; margin-bottom: 12px; }
}
`;

export function ensureAuthorStyles(doc: Document): void {
  if (doc.getElementById(AUTHOR_STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = AUTHOR_STYLE_ID;
  style.textContent = AUTHOR_CSS;
  doc.head.appendChild(style);
}
