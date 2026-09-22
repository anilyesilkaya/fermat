import { describe, it, expect } from 'vitest';
import {
  makeViewport,
  pdfPointToViewport,
  viewportPointToPdf,
  quadToViewportRect,
  quadsToViewportRects,
  canvasBackingSize,
  applyMatrix,
  invertMatrix,
  effectiveScale,
  type ViewBoxTuple,
  type Point,
  type QuarterTurn,
} from './transforms';

const LETTER: ViewBoxTuple = [0, 0, 612, 792];
// A page whose CropBox does not start at the origin (nonzero offset).
const CROPPED: ViewBoxTuple = [50, 100, 662, 892];

const SCALES = [0.5, 1, 1.5, 2, 3.37];
const ROTATIONS: QuarterTurn[] = [0, 90, 180, 270];
const DPRS = [1, 2];

function close(a: number, b: number, eps = 1e-6): boolean {
  return Math.abs(a - b) <= eps;
}

describe('viewport dimensions', () => {
  it('scales page size by scale for unrotated pages', () => {
    const vp = makeViewport(LETTER, 2, 0);
    expect(close(vp.width, 1224)).toBe(true);
    expect(close(vp.height, 1584)).toBe(true);
  });

  it('swaps width/height on quarter turns', () => {
    const vp = makeViewport(LETTER, 1, 90);
    expect(close(vp.width, 792)).toBe(true);
    expect(close(vp.height, 612)).toBe(true);
  });

  it('uses CropBox extent (not absolute coords) for size', () => {
    const vp = makeViewport(CROPPED, 1, 0);
    expect(close(vp.width, 612)).toBe(true);
    expect(close(vp.height, 792)).toBe(true);
  });
});

describe('round-trip identity across scale, rotation, CropBox, DPR', () => {
  const samplePdfPoints: Point[] = [
    [0, 0],
    [612, 792],
    [306, 396],
    [72, 650],
    [540, 120],
  ];

  for (const viewBox of [LETTER, CROPPED]) {
    for (const scale of SCALES) {
      for (const rotation of ROTATIONS) {
        it(`pdf→viewport→pdf is identity (viewBox=${viewBox}, scale=${scale}, rot=${rotation})`, () => {
          const vp = makeViewport(viewBox, scale, rotation);
          // Only sample points inside this page's box so we test realistic anchors.
          const [x0, y0, x1, y1] = viewBox;
          for (const [px, py] of samplePdfPoints) {
            const cx = x0 + ((px - LETTER[0]) / (LETTER[2] - LETTER[0])) * (x1 - x0);
            const cy = y0 + ((py - LETTER[1]) / (LETTER[3] - LETTER[1])) * (y1 - y0);
            const back = viewportPointToPdf(vp, pdfPointToViewport(vp, [cx, cy]));
            expect(close(back[0], cx, 1e-4)).toBe(true);
            expect(close(back[1], cy, 1e-4)).toBe(true);
          }
        });
      }
    }
  }

  it('DPR never changes the round trip (anchor is DPR-independent)', () => {
    for (const dpr of DPRS) {
      const vp = makeViewport(LETTER, 2, 90);
      const p: Point = [123, 456];
      const back = viewportPointToPdf(vp, pdfPointToViewport(vp, p));
      expect(close(back[0], 123, 1e-4)).toBe(true);
      expect(close(back[1], 456, 1e-4)).toBe(true);
      // DPR only affects the backing store, not layout size.
      const sizing = canvasBackingSize(vp, dpr);
      expect(sizing.cssWidth).toBe(vp.width);
      expect(sizing.pixelWidth).toBe(Math.round(vp.width * dpr));
    }
  });
});

describe('corner mapping (origin flip)', () => {
  it('maps the PDF top-left corner to viewport (0,0) when unrotated', () => {
    const vp = makeViewport(LETTER, 1, 0);
    // PDF top-left is (x0, y1) because PDF y grows up.
    const [vx, vy] = pdfPointToViewport(vp, [0, 792]);
    expect(close(vx, 0)).toBe(true);
    expect(close(vy, 0)).toBe(true);
  });

  it('maps the PDF bottom-left corner to viewport bottom-left', () => {
    const vp = makeViewport(LETTER, 1, 0);
    const [vx, vy] = pdfPointToViewport(vp, [0, 0]);
    expect(close(vx, 0)).toBe(true);
    expect(close(vy, 792)).toBe(true);
  });

  it('accounts for a nonzero CropBox offset at the corner', () => {
    const vp = makeViewport(CROPPED, 1, 0);
    // Top-left of a cropped page is (x0, y1) = (50, 892) → viewport (0,0).
    const [vx, vy] = pdfPointToViewport(vp, [50, 892]);
    expect(close(vx, 0)).toBe(true);
    expect(close(vy, 0)).toBe(true);
  });
});

describe('quad → rect', () => {
  it('produces a tight rect for one line', () => {
    const vp = makeViewport(LETTER, 1, 0);
    // A line quad [TL, TR, BR, BL] in PDF space (y up).
    const quad: Point[] = [
      [72, 650],
      [240, 650],
      [240, 635],
      [72, 635],
    ];
    const rect = quadToViewportRect(vp, quad);
    expect(close(rect.left, 72)).toBe(true);
    expect(close(rect.width, 168)).toBe(true);
    // Top in viewport = 792 - 650 = 142; height = 15.
    expect(close(rect.top, 142)).toBe(true);
    expect(close(rect.height, 15)).toBe(true);
  });

  it('keeps one rect per line for a multiline selection (no giant bbox)', () => {
    const vp = makeViewport(LETTER, 1, 0);
    // Two lines in a left column; a merged bbox would span the full width and
    // cover the right column. Per-line rects must each stay ~200pt wide.
    const line1: Point[] = [
      [72, 650],
      [280, 650],
      [280, 635],
      [72, 635],
    ];
    const line2: Point[] = [
      [72, 620],
      [260, 620],
      [260, 605],
      [72, 605],
    ];
    const rects = quadsToViewportRects(vp, [line1, line2]);
    expect(rects).toHaveLength(2);
    for (const r of rects) {
      expect(r.width).toBeLessThan(230);
      expect(r.left).toBeGreaterThanOrEqual(71);
    }
    // The two rects are on different vertical bands (distinct lines).
    expect(rects[0]!.top).toBeLessThan(rects[1]!.top);
  });
});

describe('matrix helpers', () => {
  it('invertMatrix throws on a singular matrix', () => {
    expect(() => invertMatrix([0, 0, 0, 0, 0, 0])).toThrow(/singular/);
  });

  it('applyMatrix composes with its inverse to identity', () => {
    const m = makeViewport(CROPPED, 1.5, 270).transform;
    const inv = invertMatrix(m);
    const p: Point = [200, 300];
    const round = applyMatrix(inv, applyMatrix(m, p));
    expect(close(round[0], 200, 1e-4)).toBe(true);
    expect(close(round[1], 300, 1e-4)).toBe(true);
  });
});

describe('effectiveScale (UserUnit)', () => {
  it('folds userUnit into scale', () => {
    expect(effectiveScale(2, 1)).toBe(2);
    expect(effectiveScale(2, 1.5)).toBe(3);
  });

  it('a page with userUnit renders larger for the same css zoom', () => {
    const normal = makeViewport(LETTER, effectiveScale(1, 1), 0);
    const big = makeViewport(LETTER, effectiveScale(1, 2), 0);
    expect(big.width).toBeCloseTo(normal.width * 2, 5);
  });

  it('invalid scale throws', () => {
    expect(() => makeViewport(LETTER, 0, 0)).toThrow(/scale/);
    expect(() => makeViewport(LETTER, -1, 0)).toThrow(/scale/);
    expect(() => makeViewport(LETTER, Number.NaN, 0)).toThrow(/scale/);
  });

  it('non-quarter-turn rotation throws', () => {
    expect(() => makeViewport(LETTER, 1, 45)).toThrow(/quarter turn/);
  });
});
