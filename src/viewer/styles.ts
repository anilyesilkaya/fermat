/**
 * Reader styles, injected as a single <style> element.
 *
 * Kept as an inline string (rather than a separate .css asset) so the reader
 * bundle stays a single JS file — simpler to drop into a nested subdirectory and
 * to reason about for the "self-contained, no external requests" contract. All
 * values are static, so exported output is deterministic.
 *
 * Layout: each page is a "spread" — the rendered page on the left, its notes in
 * an adjacent margin rail on the right. Below a width breakpoint the rail moves
 * beneath the page (notes stacked in reading order) so the PDF is never covered
 * on small screens.
 *
 * Theming: all chrome colors are CSS custom properties on .fx-reader, and a
 * [data-theme="dark"] block overrides them. Only the chrome recolors — the PDF
 * page stays white "paper" (its raster can't be recolored and highlights blend
 * against white via mix-blend-mode:multiply, so inverting it would break both).
 */

export const READER_STYLE_ID = 'fermat-reader-styles';

export const READER_CSS = `
.fx-reader {
  --fx-margin-width: 340px;
  --fx-gap: 24px;
  --fx-focus: #2b6cb0;
  /* Chrome palette (light). The dark block below overrides these. */
  --fx-fg: #1a202c;
  --fx-bg: #f5f6f8;
  --fx-header-bg: #ffffff;
  --fx-line: #e2e8f0;
  --fx-muted: #718096;
  --fx-paper: #ffffff;
  --fx-placeholder: #a0aec0;
  --fx-card-bg: #ffffff;
  --fx-card-left: #cbd5e0;
  --fx-code-bg: #f7fafc;
  --fx-tag-bg: #edf2f7;
  --fx-tag-fg: #4a5568;
  --fx-btn-bg: #ffffff;
  --fx-btn-fg: #2d3748;
  --fx-err-bg: #fff5f5;
  --fx-err-border: #feb2b2;
  --fx-err-fg: #822727;
  color: var(--fx-fg);
  background: var(--fx-bg);
  font: 16px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  box-sizing: border-box;
  height: 100%;
  display: flex;
  flex-direction: column;
}
.fx-reader[data-theme="dark"] {
  --fx-focus: #7aa7e0;
  --fx-fg: #e6e7ea;
  --fx-bg: #16171b;
  --fx-header-bg: #20212a;
  --fx-line: #31323d;
  --fx-muted: #9aa0ac;
  /* Page stays white paper; only its placeholder text tint changes. */
  --fx-paper: #ffffff;
  --fx-placeholder: #6b7280;
  --fx-card-bg: #20212a;
  --fx-card-left: #3a3c48;
  --fx-code-bg: #171820;
  --fx-tag-bg: #2b2d38;
  --fx-tag-fg: #c3c8d2;
  --fx-btn-bg: #2b2d38;
  --fx-btn-fg: #e6e7ea;
  --fx-err-bg: #2a1416;
  --fx-err-border: #7a2b2b;
  --fx-err-fg: #f2b8b8;
}
.fx-reader *, .fx-reader *::before, .fx-reader *::after { box-sizing: inherit; }

.fx-header {
  flex: 0 0 auto;
  padding: 12px 20px;
  background: var(--fx-header-bg);
  border-bottom: 1px solid var(--fx-line);
  display: flex;
  align-items: center;
  gap: 12px;
}
.fx-title { font-size: 1.05rem; font-weight: 600; margin: 0; }
.fx-pageinfo { color: var(--fx-muted); font-size: 0.85rem; }
.fx-actions { margin-left: auto; display: flex; align-items: center; gap: 8px; }
.fx-btn {
  appearance: none;
  border: 1px solid var(--fx-line);
  background: var(--fx-btn-bg);
  color: var(--fx-btn-fg);
  border-radius: 6px;
  padding: 5px 10px;
  font: inherit;
  font-size: 0.85rem;
  line-height: 1;
  cursor: pointer;
  white-space: nowrap;
}
.fx-btn:hover { border-color: var(--fx-focus); }
.fx-btn:focus-visible { outline: 2px solid var(--fx-focus); outline-offset: 1px; }

.fx-scroll {
  flex: 1 1 auto;
  overflow: auto;
  padding: var(--fx-gap);
  scroll-behavior: smooth;
}

.fx-page {
  display: flex;
  gap: var(--fx-gap);
  align-items: flex-start;
  margin: 0 auto var(--fx-gap);
  max-width: 100%;
}
.fx-page-main {
  position: relative;
  flex: 0 0 auto;
  /* Natural size is the page's CSS-pixel size (set inline), but never wider than
     the available column: on a phone the page scales down to fit instead of
     forcing horizontal scroll. aspect-ratio (set inline) holds the box height
     whether or not the canvas is currently mounted (pages are virtualized). */
  max-width: 100%;
  background: var(--fx-paper);
  box-shadow: 0 1px 4px rgba(0,0,0,0.15);
}
/* Canvas and placeholder fill the page box; the box's size comes from
   width + aspect-ratio, so mounting/unmounting the canvas never reflows. */
.fx-page-canvas {
  position: absolute;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
}
.fx-page-placeholder {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--fx-placeholder);
  font-size: 0.85rem;
}

.fx-highlights {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.fx-hl {
  position: absolute;
  pointer-events: auto;
  cursor: pointer;
  border-radius: 2px;
  mix-blend-mode: multiply;
  opacity: 0.85;
  transition: outline-color 0.15s;
  outline: 2px solid transparent;
}
.fx-hl:hover, .fx-hl.fx-active { outline-color: var(--fx-focus); }
.fx-hl-point {
  /* Positioned by its center (left/top are the anchor point); a fixed, tappable
     size that does NOT scale with the page, so it stays visible on a phone. */
  width: 16px;
  height: 16px;
  transform: translate(-50%, -50%);
  border-radius: 50%;
  border: 2px solid var(--fx-focus);
  background: rgba(43,108,176,0.25);
  mix-blend-mode: normal;
}

.fx-margin {
  flex: 0 0 var(--fx-margin-width);
  position: relative;
  min-width: 0;
}
.fx-card {
  position: absolute;
  left: 0;
  width: 100%;
  background: var(--fx-card-bg);
  border: 1px solid var(--fx-line);
  border-left: 4px solid var(--fx-card-left);
  border-radius: 6px;
  padding: 10px 12px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.08);
  scroll-margin-top: 16px;
}
.fx-card.fx-active { border-left-color: var(--fx-focus); box-shadow: 0 0 0 2px var(--fx-focus); }
.fx-card-body { font-size: 0.92rem; }
.fx-card-body > :first-child { margin-top: 0; }
.fx-card-body > :last-child { margin-bottom: 0; }
.fx-card-body pre { overflow: auto; background: var(--fx-code-bg); padding: 8px; border-radius: 4px; }
.fx-card-body code { background: var(--fx-code-bg); padding: 1px 4px; border-radius: 4px; }
.fx-card-body pre code { background: none; padding: 0; }
.fx-card-body img { max-width: 100%; height: auto; }
.fx-card-tags { margin-top: 6px; display: flex; flex-wrap: wrap; gap: 4px; }
.fx-tag { font-size: 0.72rem; color: var(--fx-tag-fg); background: var(--fx-tag-bg); border-radius: 10px; padding: 1px 8px; }

/* Narrow screens: stack notes under the page, in reading order, and let the
   page fill the width (it scales down via max-width + aspect-ratio). */
@media (max-width: 900px) {
  .fx-page { flex-direction: column; }
  .fx-page-main { width: 100%; }
  .fx-margin { flex-basis: auto; width: 100%; }
  /* Cards now flow in normal order; drop the absolute-layout min-height so there
     is no large empty gap under the last note (min-height is set inline in JS). */
  .fx-margin { min-height: 0 !important; }
  .fx-card { position: static; width: auto; margin-bottom: var(--fx-gap); }
}

.fx-error {
  margin: var(--fx-gap);
  padding: 16px;
  border: 1px solid var(--fx-err-border);
  background: var(--fx-err-bg);
  color: var(--fx-err-fg);
  border-radius: 6px;
}
`;

/** Inject the reader stylesheet once into the given document. */
export function ensureReaderStyles(doc: Document): void {
  if (doc.getElementById(READER_STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = READER_STYLE_ID;
  style.textContent = READER_CSS;
  doc.head.appendChild(style);
}
