import { describe, it, expect } from 'vitest';
import { layoutMarginCards } from './layout';

describe('layoutMarginCards', () => {
  it('places non-overlapping cards at their ideal tops', () => {
    const result = layoutMarginCards(
      [
        { id: 'a', idealTop: 0, height: 50 },
        { id: 'b', idealTop: 100, height: 50 },
      ],
      { gap: 8 },
    );
    expect(result.cards.map((c) => c.top)).toEqual([0, 100]);
    expect(result.cards.every((c) => c.displacement === 0)).toBe(true);
  });

  it('pushes later cards down to avoid overlap, preserving order', () => {
    const result = layoutMarginCards(
      [
        { id: 'a', idealTop: 0, height: 100 },
        { id: 'b', idealTop: 50, height: 40 },
      ],
      { gap: 10 },
    );
    // a at 0..100; b cannot start before 110.
    expect(result.cards[0]!.top).toBe(0);
    expect(result.cards[1]!.top).toBe(110);
    expect(result.cards[1]!.displacement).toBe(60);
  });

  it('is deterministic regardless of input order', () => {
    const input = [
      { id: 'b', idealTop: 50, height: 40 },
      { id: 'a', idealTop: 0, height: 100 },
    ];
    const r1 = layoutMarginCards(input, { gap: 10 });
    const r2 = layoutMarginCards([...input].reverse(), { gap: 10 });
    expect(r1.cards.map((c) => c.id)).toEqual(r2.cards.map((c) => c.id));
    expect(r1.cards.map((c) => c.top)).toEqual(r2.cards.map((c) => c.top));
    // Sorted by idealTop then id → a before b.
    expect(r1.cards.map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('breaks idealTop ties by id', () => {
    const result = layoutMarginCards(
      [
        { id: 'z', idealTop: 10, height: 20 },
        { id: 'a', idealTop: 10, height: 20 },
      ],
      { gap: 5 },
    );
    expect(result.cards.map((c) => c.id)).toEqual(['a', 'z']);
  });

  it('flags overflow when content exceeds available height and never drops a card', () => {
    const result = layoutMarginCards(
      [
        { id: 'a', idealTop: 0, height: 300 },
        { id: 'b', idealTop: 10, height: 300 },
      ],
      { gap: 10, availableHeight: 400 },
    );
    expect(result.cards).toHaveLength(2); // nothing lost
    expect(result.overflow).toBe(true);
    expect(result.contentHeight).toBeGreaterThan(400);
  });

  it('does not flag overflow when it fits', () => {
    const result = layoutMarginCards([{ id: 'a', idealTop: 0, height: 100 }], {
      availableHeight: 400,
    });
    expect(result.overflow).toBe(false);
  });

  it('respects minTop for the first card', () => {
    const result = layoutMarginCards([{ id: 'a', idealTop: 0, height: 50 }], { minTop: 20 });
    expect(result.cards[0]!.top).toBe(20);
  });
});
