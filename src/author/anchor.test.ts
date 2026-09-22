import { describe, it, expect } from 'vitest';
import { buildTextAnchor, buildRegionAnchor, buildPointAnchor } from './anchor';
import { makeViewport } from '../pdf/transforms';
import { pdfPointToViewport } from '../pdf/transforms';
import type { PageInfo } from '../pdf/document';
import { Anchor } from '../model/schema';

const info: PageInfo = {
  pageIndex: 2,
  viewBox: [0, 0, 612, 792],
  rotation: 0,
  userUnit: 1,
};
const viewport = makeViewport(info.viewBox, 1.5, 0);

describe('buildTextAnchor', () => {
  it('embeds the page frame and validates against the schema', () => {
    const anchor = buildTextAnchor({
      info,
      viewport,
      rects: [{ left: 30, top: 45, width: 200, height: 18 }],
      quote: { exact: '  hello   world ', prefix: 'a', suffix: 'b' },
    });
    // Schema-valid.
    expect(() => Anchor.parse(anchor)).not.toThrow();
    expect(anchor.kind).toBe('text');
    expect(anchor.pageIndex).toBe(2);
    expect(anchor.pageViewBox).toEqual([0, 0, 612, 792]);
    expect(anchor.coordinateSpace).toBe('pdf-user-space');
    if (anchor.kind === 'text') {
      expect(anchor.quads).toHaveLength(1);
      // Quote text was normalized (whitespace collapsed).
      expect(anchor.quote?.exact).toBe('hello world');
    }
  });

  it('round-trips: a captured quad maps back to the original viewport rect', () => {
    const rect = { left: 30, top: 45, width: 200, height: 18 };
    const anchor = buildTextAnchor({ info, viewport, rects: [rect] });
    if (anchor.kind !== 'text') throw new Error('expected text');
    const quad = anchor.quads[0]!;
    // Map the stored top-left PDF vertex back to viewport space.
    const tlView = pdfPointToViewport(viewport, quad[0]);
    expect(tlView[0]).toBeCloseTo(rect.left, 3);
    expect(tlView[1]).toBeCloseTo(rect.top, 3);
    const brView = pdfPointToViewport(viewport, quad[2]);
    expect(brView[0]).toBeCloseTo(rect.left + rect.width, 3);
    expect(brView[1]).toBeCloseTo(rect.top + rect.height, 3);
  });

  it('throws when no meaningful line rects exist', () => {
    expect(() =>
      buildTextAnchor({ info, viewport, rects: [{ left: 0, top: 0, width: 0, height: 0 }] }),
    ).toThrow();
  });
});

describe('buildRegionAnchor', () => {
  it('produces a schema-valid region quad', () => {
    const anchor = buildRegionAnchor({
      info,
      viewport,
      rect: { left: 50, top: 60, width: 120, height: 90 },
    });
    expect(() => Anchor.parse(anchor)).not.toThrow();
    expect(anchor.kind).toBe('region');
  });
});

describe('buildPointAnchor', () => {
  it('round-trips a click position through viewport space', () => {
    const anchor = buildPointAnchor({ info, viewport, x: 100, y: 200 });
    expect(() => Anchor.parse(anchor)).not.toThrow();
    if (anchor.kind !== 'point') throw new Error('expected point');
    const back = pdfPointToViewport(viewport, anchor.point);
    expect(back[0]).toBeCloseTo(100, 3);
    expect(back[1]).toBeCloseTo(200, 3);
  });
});
