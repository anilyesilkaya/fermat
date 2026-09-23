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
 */

export const READER_STYLE_ID = 'fermat-reader-styles';

export const READER_CSS = `
.fx-reader {
  --fx-margin-width: 340px;
  --fx-gap: 24px;
  --fx-focus: #2b6cb0;
  color: #1a202c;
  background: #f5f6f8;
  font: 16px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  box-sizing: border-box;
  height: 100%;
  display: flex;
  flex-direction: column;
}
.fx-reader *, .fx-reader *::before, .fx-reader *::after { box-sizing: inherit; }

.fx-header {
  flex: 0 0 auto;
  padding: 12px 20px;
  background: #fff;
  border-bottom: 1px solid #e2e8f0;
  display: flex;
  align-items: baseline;
  gap: 12px;
}
.fx-title { font-size: 1.05rem; font-weight: 600; margin: 0; }
.fx-pageinfo { color: #718096; font-size: 0.85rem; }

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
  background: #fff;
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
  color: #a0aec0;
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
  background: #fff;
  border: 1px solid #e2e8f0;
  border-left: 4px solid #cbd5e0;
  border-radius: 6px;
  padding: 10px 12px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.08);
  scroll-margin-top: 16px;
}
.fx-card.fx-active { border-left-color: var(--fx-focus); box-shadow: 0 0 0 2px var(--fx-focus); }
.fx-card-body { font-size: 0.92rem; }
.fx-card-body > :first-child { margin-top: 0; }
.fx-card-body > :last-child { margin-bottom: 0; }
.fx-card-body pre { overflow: auto; background: #f7fafc; padding: 8px; border-radius: 4px; }
.fx-card-body img { max-width: 100%; height: auto; }
.fx-card-tags { margin-top: 6px; display: flex; flex-wrap: wrap; gap: 4px; }
.fx-tag { font-size: 0.72rem; color: #4a5568; background: #edf2f7; border-radius: 10px; padding: 1px 8px; }

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
  border: 1px solid #feb2b2;
  background: #fff5f5;
  color: #822727;
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
