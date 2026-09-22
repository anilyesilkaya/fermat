import type { PublicAnnotation } from '../model/projection';
import type { Anchor } from '../model/schema';
import { quadToViewportRect, type Viewport, type ViewportRect } from '../pdf/transforms';

/**
 * Shared, framework-free helpers to turn an anchor + viewport into the overlay
 * rectangles the highlight layer draws. Used by BOTH author and viewer so
 * highlight placement is computed one way only.
 */

/** All viewport rects a single anchor highlights (one per text-line quad). */
export function anchorHighlightRects(viewport: Viewport, anchor: Anchor): ViewportRect[] {
  switch (anchor.kind) {
    case 'text':
      return anchor.quads.map((q) => quadToViewportRect(viewport, q));
    case 'region':
      return [quadToViewportRect(viewport, anchor.quad)];
    case 'point': {
      const [vx, vy] = quadPointToViewport(viewport, anchor.point);
      // A small marker box around the point.
      const size = 16;
      return [{ left: vx - size / 2, top: vy - size / 2, width: size, height: size }];
    }
  }
}

function quadPointToViewport(viewport: Viewport, point: readonly [number, number]): [number, number] {
  const [a, b, c, d, e, f] = viewport.transform;
  return [a * point[0] + c * point[1] + e, b * point[0] + d * point[1] + f];
}

/** The topmost viewport y of an anchor — the ideal top for its margin card. */
export function anchorTopViewportY(viewport: Viewport, anchor: Anchor): number {
  const rects = anchorHighlightRects(viewport, anchor);
  let min = Infinity;
  for (const r of rects) if (r.top < min) min = r.top;
  return Number.isFinite(min) ? min : 0;
}

/** Stable per-note info the margin layer needs, derived from public data. */
export interface MarginNoteInput {
  id: string;
  anchor: Anchor;
  bodyHtml: string;
}

/** Bundle a public annotation with its rendered (sanitized) HTML body. */
export function toMarginNoteInput(ann: PublicAnnotation, bodyHtml: string): MarginNoteInput {
  return { id: ann.id, anchor: ann.anchor, bodyHtml };
}
