import type { Anchor, Quad, Rotation, ViewBox } from '../model/schema';
import type { Viewport, Point } from '../pdf/transforms';
import type { PageInfo } from '../pdf/document';
import { lineRectsToQuads, regionRectToQuad, clickPointToPdf, type LineRect } from '../pdf/selection';
import { normalizeQuoteText, NORMALIZATION_VERSION } from '../model/normalize';

/**
 * Build persisted anchors from viewport-space geometry + the page's canonical
 * frame.
 *
 * The stored anchor carries the page frame (viewBox, rotation, userUnit) so it
 * can be re-projected at any zoom/rotation on reload — the geometry itself is in
 * PDF user space and never depends on the CSS scale it was captured at. Pure, so
 * the coordinate capture is unit-testable without a browser.
 */

function pageFrame(info: PageInfo): {
  pageIndex: number;
  pageViewBox: ViewBox;
  pageRotation: Rotation;
  userUnit: number;
  coordinateSpace: 'pdf-user-space';
} {
  const vb = info.viewBox;
  return {
    pageIndex: info.pageIndex,
    // Copy into a fresh mutable tuple: PageInfo.viewBox is readonly, the schema
    // ViewBox is a mutable [x0,y0,x1,y1].
    pageViewBox: [vb[0], vb[1], vb[2], vb[3]],
    pageRotation: info.rotation,
    userUnit: info.userUnit,
    coordinateSpace: 'pdf-user-space',
  };
}

export interface TextSelectionInput {
  info: PageInfo;
  viewport: Viewport;
  /** Per-line rects from `range.getClientRects()`, page-local CSS pixels. */
  rects: readonly LineRect[];
  /** The selected text and its surrounding context (raw; normalized here). */
  quote?: { exact: string; prefix: string; suffix: string };
}

/** Build a text anchor (one quad per selected line) with optional quote context. */
export function buildTextAnchor(input: TextSelectionInput): Anchor {
  const quads = lineRectsToQuads(input.viewport, input.rects);
  if (quads.length === 0) throw new Error('selection produced no usable line rectangles');
  const anchor: Anchor = {
    kind: 'text',
    ...pageFrame(input.info),
    quads: quads as Quad[],
    ...(input.quote
      ? {
          quote: {
            exact: normalizeQuoteText(input.quote.exact),
            prefix: normalizeQuoteText(input.quote.prefix),
            suffix: normalizeQuoteText(input.quote.suffix),
            normalizationVersion: NORMALIZATION_VERSION,
          },
        }
      : {}),
  };
  return anchor;
}

export interface RegionInput {
  info: PageInfo;
  viewport: Viewport;
  /** The rubber-band rect in page-local CSS pixels. */
  rect: LineRect;
}

/** Build a region anchor from a single rubber-band rectangle. */
export function buildRegionAnchor(input: RegionInput): Anchor {
  return {
    kind: 'region',
    ...pageFrame(input.info),
    quad: regionRectToQuad(input.viewport, input.rect),
  };
}

export interface PointInput {
  info: PageInfo;
  viewport: Viewport;
  /** Click position in page-local CSS pixels. */
  x: number;
  y: number;
}

/** Build a point anchor from a click position. */
export function buildPointAnchor(input: PointInput): Anchor {
  const p: Point = clickPointToPdf(input.viewport, input.x, input.y);
  return {
    kind: 'point',
    ...pageFrame(input.info),
    point: [p[0], p[1]],
  };
}
