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
:root { color-scheme: light; }
* , *::before, *::after { box-sizing: border-box; }
body { margin: 0; }

.fa-app {
  --fa-accent: #2b6cb0;
  --fa-border: #e2e8f0;
  --fa-muted: #718096;
  font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  color: #1a202c;
  height: 100vh;
  display: grid;
  grid-template-columns: 300px 1fr;
}

.fa-sidebar {
  border-right: 1px solid var(--fa-border);
  background: #fafbfc;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.fa-brand { padding: 14px 16px; border-bottom: 1px solid var(--fa-border); }
.fa-brand h1 { font-size: 1.1rem; margin: 0; }
.fa-brand p { margin: 2px 0 0; color: var(--fa-muted); font-size: 0.8rem; }

.fa-actions { padding: 12px 16px; display: flex; flex-direction: column; gap: 8px; border-bottom: 1px solid var(--fa-border); }
.fa-btn {
  appearance: none;
  border: 1px solid var(--fa-border);
  background: #fff;
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
.fa-doc:hover { background: #edf2f7; }
.fa-doc.fa-selected { background: #e6f0fb; outline: 1px solid var(--fa-accent); }
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
  background: #fff;
}
.fa-doc-name { font-weight: 600; }
.fa-spacer { flex: 1 1 auto; }
.fa-chip { font-size: 0.76rem; padding: 2px 9px; border-radius: 10px; background: #edf2f7; color: #4a5568; }
.fa-chip-saved { background: #e6ffed; color: #22543d; }
.fa-chip-saving { background: #fffbe6; color: #744210; }
.fa-chip-error { background: #fff5f5; color: #822727; }
.fa-chip-conflict { background: #fef0ff; color: #702459; }

.fa-pages { flex: 1 1 auto; overflow: auto; padding: 20px; background: #f5f6f8; }
.fa-page { display: flex; gap: 20px; align-items: flex-start; margin: 0 auto 20px; width: max-content; }
.fa-page-main { position: relative; background: #fff; box-shadow: 0 1px 4px rgba(0,0,0,0.15); }
.fa-textlayer {
  position: absolute; inset: 0; overflow: hidden; opacity: 0.2; line-height: 1;
}
.fa-textlayer span { position: absolute; white-space: pre; color: transparent; cursor: text; transform-origin: 0 0; }
.fa-overlay { position: absolute; inset: 0; pointer-events: none; }
.fa-hl { position: absolute; pointer-events: auto; cursor: pointer; border-radius: 2px; mix-blend-mode: multiply; }
.fa-hl.fa-private { outline: 1px dashed rgba(0,0,0,0.4); }
.fa-hl.fa-public { outline: 2px solid var(--fa-accent); }

.fa-margin { flex: 0 0 320px; position: relative; }
.fa-card { position: absolute; left: 0; width: 100%; background: #fff; border: 1px solid var(--fa-border); border-left: 4px solid #cbd5e0; border-radius: 6px; padding: 8px 10px; }
.fa-card.fa-active { border-left-color: var(--fa-accent); box-shadow: 0 0 0 2px var(--fa-accent); }
.fa-card textarea { width: 100%; min-height: 70px; font: inherit; border: 1px solid var(--fa-border); border-radius: 4px; padding: 6px; resize: vertical; }
.fa-card-row { display: flex; gap: 6px; align-items: center; margin-top: 6px; }
.fa-card-row input[type=text] { flex: 1 1 auto; font: inherit; border: 1px solid var(--fa-border); border-radius: 4px; padding: 4px 6px; }
.fa-toggle { font-size: 0.78rem; display: flex; align-items: center; gap: 4px; }
.fa-preview { font-size: 0.9rem; border-top: 1px dashed var(--fa-border); margin-top: 6px; padding-top: 6px; }

.fa-seltoolbar {
  position: fixed; z-index: 20; display: none; gap: 4px; padding: 4px;
  background: #1a202c; border-radius: 6px; box-shadow: 0 2px 8px rgba(0,0,0,0.3);
}
.fa-seltoolbar button { background: #2d3748; color: #fff; border: 0; border-radius: 4px; padding: 4px 8px; font: inherit; cursor: pointer; }
.fa-seltoolbar button:hover { background: var(--fa-accent); }

.fa-empty { margin: auto; color: var(--fa-muted); text-align: center; padding: 40px; }
.fa-banner { padding: 8px 14px; background: #fffbe6; color: #744210; border-bottom: 1px solid #f6e05e; font-size: 0.85rem; }
.fa-error-banner { padding: 8px 14px; background: #fff5f5; color: #822727; border-bottom: 1px solid #feb2b2; font-size: 0.85rem; }
`;

export function ensureAuthorStyles(doc: Document): void {
  if (doc.getElementById(AUTHOR_STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = AUTHOR_STYLE_ID;
  style.textContent = AUTHOR_CSS;
  doc.head.appendChild(style);
}
