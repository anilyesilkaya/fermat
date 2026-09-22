import type { Viewport, Point } from './transforms';
import { viewportPointToPdf } from './transforms';
import type { Quad } from '../model/schema';

/**
 * Convert a browser text selection into per-line quads in canonical PDF user
 * space.
 *
 * How selection geometry is obtained (in the browser): PDF.js renders a text
 * layer of positioned spans over the canvas. A user selection yields a DOM
 * `Range`; `range.getClientRects()` returns ONE rectangle PER LINE (and per
 * style run). We map each line rect independently, so a multiline or
 * cross-column selection becomes several tight quads — never a single giant
 * bounding box spanning unrelated text.
 *
 * This function is pure: it takes the already-measured rects (in viewport/CSS
 * pixels, relative to the page's top-left) plus the page viewport, and returns
 * quads. That keeps the tricky coordinate math unit-testable without a browser;
 * only the rect *measurement* is browser-dependent.
 */

/** A line rectangle in the page element's local CSS pixel space (origin top-left). */
export interface LineRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Drop rects that are empty or vanishingly thin (selection artifacts). */
function isMeaningful(rect: LineRect, minSize: number): boolean {
  return rect.width > minSize && rect.height > minSize;
}

export interface SelectionToQuadsOptions {
  /** Ignore rects smaller than this (px). Filters zero-width caret rects. */
  minSize?: number;
}

/**
 * Map line rects (page-local viewport pixels) → PDF-user-space quads, one quad
 * per line. Each quad's vertices are ordered [top-left, top-right, bottom-right,
 * bottom-left] in the page's reading orientation.
 */
export function lineRectsToQuads(
  viewport: Viewport,
  rects: readonly LineRect[],
  options: SelectionToQuadsOptions = {},
): Quad[] {
  const minSize = options.minSize ?? 0.5;
  const quads: Quad[] = [];
  for (const rect of rects) {
    if (!isMeaningful(rect, minSize)) continue;
    // The four viewport-space corners of this line box.
    const vTL: Point = [rect.left, rect.top];
    const vTR: Point = [rect.left + rect.width, rect.top];
    const vBR: Point = [rect.left + rect.width, rect.top + rect.height];
    const vBL: Point = [rect.left, rect.top + rect.height];
    // Map each to PDF user space via the inverse viewport transform.
    const pTL = viewportPointToPdf(viewport, vTL);
    const pTR = viewportPointToPdf(viewport, vTR);
    const pBR = viewportPointToPdf(viewport, vBR);
    const pBL = viewportPointToPdf(viewport, vBL);
    quads.push([
      [pTL[0], pTL[1]],
      [pTR[0], pTR[1]],
      [pBR[0], pBR[1]],
      [pBL[0], pBL[1]],
    ]);
  }
  return quads;
}

/**
 * Convert a single region drag (a rubber-band rect in page-local viewport
 * pixels) into one PDF-user-space quad. Used for region notes on figures and
 * scanned pages that have no selectable text.
 */
export function regionRectToQuad(viewport: Viewport, rect: LineRect): Quad {
  const vTL: Point = [rect.left, rect.top];
  const vTR: Point = [rect.left + rect.width, rect.top];
  const vBR: Point = [rect.left + rect.width, rect.top + rect.height];
  const vBL: Point = [rect.left, rect.top + rect.height];
  const pTL = viewportPointToPdf(viewport, vTL);
  const pTR = viewportPointToPdf(viewport, vTR);
  const pBR = viewportPointToPdf(viewport, vBR);
  const pBL = viewportPointToPdf(viewport, vBL);
  return [
    [pTL[0], pTL[1]],
    [pTR[0], pTR[1]],
    [pBR[0], pBR[1]],
    [pBL[0], pBL[1]],
  ];
}

/** Convert a single click point (page-local viewport pixels) → PDF-space point. */
export function clickPointToPdf(viewport: Viewport, x: number, y: number): Point {
  return viewportPointToPdf(viewport, [x, y]);
}
