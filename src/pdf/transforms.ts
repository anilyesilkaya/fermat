/**
 * Pure coordinate transforms between canonical PDF user space and viewport
 * (CSS-pixel) space.
 *
 * These reimplement the exact matrix PDF.js's `PageViewport` builds, so an HTML
 * overlay positioned with these functions lines up with a canvas rendered by
 * PDF.js at the same `scale` and `rotation`. Keeping them pure (no PDF.js import)
 * lets us assert invariants — round-trip identity, corner mapping, CropBox
 * offset, quarter-turn rotation — in fast unit tests.
 *
 * Spaces:
 *   - PDF user space: origin bottom-left, y up. Anchors are stored here.
 *   - Viewport/CSS space: origin top-left, y down. Overlays are laid out here.
 *
 * Device pixel ratio does NOT appear in these transforms. DPR scales only the
 * canvas backing store (see `canvasBackingSize`); the CSS layout size — and thus
 * anchor placement — depends on `scale` alone. The canonical anchor never
 * changes with DPR.
 */

/** Affine matrix `[a, b, c, d, e, f]`, same convention as PDF.js. */
export type Matrix = readonly [number, number, number, number, number, number];

/** A 2D point `[x, y]`. */
export type Point = readonly [number, number];

/** PDF view box `[x0, y0, x1, y1]` (PDF.js `page.view`). */
export type ViewBoxTuple = readonly [number, number, number, number];

/** Quarter-turn rotation. */
export type QuarterTurn = 0 | 90 | 180 | 270;

/** An axis-aligned rectangle in viewport/CSS space. */
export interface ViewportRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Viewport {
  /** PDF-user-space → viewport transform. */
  readonly transform: Matrix;
  /** Layout width in CSS pixels. */
  readonly width: number;
  /** Layout height in CSS pixels. */
  readonly height: number;
  /** Total rotation actually applied (normalized). */
  readonly rotation: QuarterTurn;
  /** Effective scale actually applied (includes userUnit if the caller folded it in). */
  readonly scale: number;
}

/** Apply an affine matrix to a point. */
export function applyMatrix(m: Matrix, p: Point): Point {
  const [a, b, c, d, e, f] = m;
  const [x, y] = p;
  return [a * x + c * y + e, b * x + d * y + f];
}

/** Invert an affine matrix. Throws if singular (determinant ~ 0). */
export function invertMatrix(m: Matrix): Matrix {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) {
    throw new Error('cannot invert a singular affine matrix');
  }
  const ia = d / det;
  const ib = -b / det;
  const ic = -c / det;
  const id = a / det;
  const ie = -(ia * e + ic * f);
  const if_ = -(ib * e + id * f);
  return [ia, ib, ic, id, ie, if_];
}

/** Apply the inverse of `m` to a point (viewport → PDF user space). */
export function applyInverseMatrix(m: Matrix, p: Point): Point {
  return applyMatrix(invertMatrix(m), p);
}

function normalizeRotation(rotation: number): QuarterTurn {
  let r = rotation % 360;
  if (r < 0) r += 360;
  if (r === 0 || r === 90 || r === 180 || r === 270) return r;
  throw new Error(`rotation must be a quarter turn, got ${rotation}`);
}

/**
 * Build a viewport for a page. Mirrors PDF.js `PageViewport` (default flip, so
 * viewport y grows downward from the top-left).
 *
 * @param viewBox  PDF.js `page.view` = [x0, y0, x1, y1] (already CropBox-clipped).
 * @param scale    Effective scale. To honor UserUnit, pass `cssZoom * userUnit`
 *                 and use the same value for the PDF.js render, so overlay and
 *                 canvas agree. See `effectiveScale`.
 * @param rotation Total rotation = (inherentPageRotation + userRotation) mod 360.
 */
export function makeViewport(
  viewBox: ViewBoxTuple,
  scale: number,
  rotation: number,
): Viewport {
  if (!(scale > 0) || !Number.isFinite(scale)) {
    throw new Error(`scale must be a positive finite number, got ${scale}`);
  }
  const rot = normalizeRotation(rotation);
  const [x0, y0, x1, y1] = viewBox;
  const centerX = (x0 + x1) / 2;
  const centerY = (y0 + y1) / 2;

  let rotateA: number;
  let rotateB: number;
  let rotateC: number;
  let rotateD: number;
  switch (rot) {
    case 180:
      rotateA = -1; rotateB = 0; rotateC = 0; rotateD = 1; break;
    case 90:
      rotateA = 0; rotateB = 1; rotateC = 1; rotateD = 0; break;
    case 270:
      rotateA = 0; rotateB = -1; rotateC = -1; rotateD = 0; break;
    case 0:
    default:
      rotateA = 1; rotateB = 0; rotateC = 0; rotateD = -1; break;
  }

  let offsetCanvasX: number;
  let offsetCanvasY: number;
  let width: number;
  let height: number;
  if (rotateA === 0) {
    offsetCanvasX = Math.abs(centerY - y0) * scale;
    offsetCanvasY = Math.abs(centerX - x0) * scale;
    width = Math.abs(y1 - y0) * scale;
    height = Math.abs(x1 - x0) * scale;
  } else {
    offsetCanvasX = Math.abs(centerX - x0) * scale;
    offsetCanvasY = Math.abs(centerY - y0) * scale;
    width = Math.abs(x1 - x0) * scale;
    height = Math.abs(y1 - y0) * scale;
  }

  const transform: Matrix = [
    rotateA * scale,
    rotateB * scale,
    rotateC * scale,
    rotateD * scale,
    offsetCanvasX - rotateA * scale * centerX - rotateC * scale * centerY,
    offsetCanvasY - rotateB * scale * centerX - rotateD * scale * centerY,
  ];

  return { transform, width, height, rotation: rot, scale };
}

/** Combine a CSS zoom with the page's UserUnit into the scale to render at. */
export function effectiveScale(cssZoom: number, userUnit: number): number {
  return cssZoom * (userUnit > 0 ? userUnit : 1);
}

/** PDF user-space point → viewport point. */
export function pdfPointToViewport(viewport: Viewport, p: Point): Point {
  return applyMatrix(viewport.transform, p);
}

/** Viewport point → PDF user-space point. */
export function viewportPointToPdf(viewport: Viewport, p: Point): Point {
  return applyInverseMatrix(viewport.transform, p);
}

/**
 * Map a single quad (4 vertices in PDF user space) to its axis-aligned bounding
 * rectangle in viewport space. Use ONE call per quad — never merge the quads of
 * a multiline text selection into one rectangle, or the highlight would cover
 * unrelated text between lines/columns.
 */
export function quadToViewportRect(
  viewport: Viewport,
  quad: readonly Point[],
): ViewportRect {
  if (quad.length === 0) throw new Error('quad must have at least one vertex');
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const vertex of quad) {
    const [vx, vy] = pdfPointToViewport(viewport, vertex);
    if (vx < minX) minX = vx;
    if (vy < minY) minY = vy;
    if (vx > maxX) maxX = vx;
    if (vy > maxY) maxY = vy;
  }
  return { left: minX, top: minY, width: maxX - minX, height: maxY - minY };
}

/** Map many quads to many rects — one rect each. Preserves input order. */
export function quadsToViewportRects(
  viewport: Viewport,
  quads: readonly (readonly Point[])[],
): ViewportRect[] {
  return quads.map((q) => quadToViewportRect(viewport, q));
}

/**
 * Backing-store pixel size for a canvas rendered at this viewport on a display
 * with the given device pixel ratio. The element's CSS size stays
 * `viewport.width × viewport.height`; only the backing store scales by DPR.
 */
export function canvasBackingSize(
  viewport: Viewport,
  devicePixelRatio: number,
): { cssWidth: number; cssHeight: number; pixelWidth: number; pixelHeight: number; dpr: number } {
  const dpr = devicePixelRatio > 0 && Number.isFinite(devicePixelRatio) ? devicePixelRatio : 1;
  return {
    cssWidth: viewport.width,
    cssHeight: viewport.height,
    pixelWidth: Math.round(viewport.width * dpr),
    pixelHeight: Math.round(viewport.height * dpr),
    dpr,
  };
}
