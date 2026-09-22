import { describe, it, expect } from 'vitest';
import { lineRectsToQuads, regionRectToQuad, clickPointToPdf } from './selection';
import { makeViewport, quadsToViewportRects, type ViewBoxTuple } from './transforms';

const LETTER: ViewBoxTuple = [0, 0, 612, 792];

describe('lineRectsToQuads', () => {
  it('produces one quad per line rect (no merged bounding box)', () => {
    const vp = makeViewport(LETTER, 1, 0);
    // Two lines in the left column of a two-column layout.
    const rects = [
      { left: 72, top: 100, width: 200, height: 14 },
      { left: 72, top: 118, width: 180, height: 14 },
    ];
    const quads = lineRectsToQuads(vp, rects);
    expect(quads).toHaveLength(2);

    // Round-trip back to viewport rects; each stays within its own column band.
    const back = quadsToViewportRects(vp, quads);
    expect(back[0]!.width).toBeCloseTo(200, 3);
    expect(back[1]!.width).toBeCloseTo(180, 3);
    // Neither rect widened to span both columns.
    for (const r of back) expect(r.width).toBeLessThan(210);
  });

  it('round-trips a line rect through PDF space back to the same viewport rect', () => {
    const vp = makeViewport(LETTER, 1.5, 90);
    const rect = { left: 120, top: 240, width: 150, height: 18 };
    const [quad] = lineRectsToQuads(vp, [rect]);
    const [back] = quadsToViewportRects(vp, [quad!]);
    expect(back!.left).toBeCloseTo(rect.left, 3);
    expect(back!.top).toBeCloseTo(rect.top, 3);
    expect(back!.width).toBeCloseTo(rect.width, 3);
    expect(back!.height).toBeCloseTo(rect.height, 3);
  });

  it('filters out zero-width caret rects', () => {
    const vp = makeViewport(LETTER, 1, 0);
    const rects = [
      { left: 72, top: 100, width: 0, height: 14 }, // caret
      { left: 72, top: 100, width: 200, height: 14 }, // real line
    ];
    expect(lineRectsToQuads(vp, rects)).toHaveLength(1);
  });

  it('quad vertices are ordered TL, TR, BR, BL in PDF space', () => {
    const vp = makeViewport(LETTER, 1, 0);
    const [quad] = lineRectsToQuads(vp, [{ left: 72, top: 100, width: 200, height: 14 }]);
    const [tl, tr, br, bl] = quad!;
    // In PDF space (y up), "top" corners have the larger y.
    expect(tl[1]).toBeGreaterThan(bl[1]);
    expect(tr[1]).toBeGreaterThan(br[1]);
    // Right corners have larger x.
    expect(tr[0]).toBeGreaterThan(tl[0]);
    expect(br[0]).toBeGreaterThan(bl[0]);
  });
});

describe('regionRectToQuad', () => {
  it('maps a rubber-band rectangle to a PDF-space quad and back', () => {
    const vp = makeViewport(LETTER, 2, 180);
    const rect = { left: 50, top: 60, width: 300, height: 200 };
    const quad = regionRectToQuad(vp, rect);
    const [back] = quadsToViewportRects(vp, [quad]);
    expect(back!.left).toBeCloseTo(rect.left, 3);
    expect(back!.top).toBeCloseTo(rect.top, 3);
    expect(back!.width).toBeCloseTo(rect.width, 3);
    expect(back!.height).toBeCloseTo(rect.height, 3);
  });
});

describe('clickPointToPdf', () => {
  it('inverts a viewport click to PDF space', () => {
    const vp = makeViewport(LETTER, 1, 0);
    // Viewport (0,0) is the PDF top-left = (0, 792).
    const p = clickPointToPdf(vp, 0, 0);
    expect(p[0]).toBeCloseTo(0, 4);
    expect(p[1]).toBeCloseTo(792, 4);
  });
});
