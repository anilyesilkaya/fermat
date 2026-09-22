/**
 * Deterministic margin-card layout.
 *
 * Each note wants to sit next to its source anchor (its `idealTop`). When cards
 * would overlap, we push later cards down while preserving reading order, then —
 * if that pushed content past the available height — we report an overflow so
 * the caller can grow the page/rail row rather than covering the PDF or losing a
 * note. Cards are never dropped and never reordered.
 *
 * Pure and framework-free so it can be unit-tested and reused by author + viewer.
 */

export interface CardInput {
  /** Stable id (annotation UUID). */
  id: string;
  /** Preferred top offset (px) — usually the anchor's top in the page's frame. */
  idealTop: number;
  /** Measured card height (px), after content + font load. */
  height: number;
}

export interface PlacedCard {
  id: string;
  top: number;
  height: number;
  /** How far this card was pushed from its ideal position (px, ≥ 0). */
  displacement: number;
}

export interface LayoutResult {
  cards: PlacedCard[];
  /** Total stack height used (px). */
  contentHeight: number;
  /** True if content exceeds `availableHeight` (caller should expand the row). */
  overflow: boolean;
}

export interface LayoutOptions {
  /** Vertical gap between adjacent cards (px). */
  gap?: number;
  /** Available rail height (px). If omitted, never flags overflow. */
  availableHeight?: number;
  /** Minimum top for the first card (px). */
  minTop?: number;
}

/**
 * Place cards top-to-bottom without overlap.
 *
 * Order: cards are processed by ascending `idealTop`, ties broken by `id` so the
 * result is fully deterministic regardless of input order.
 */
export function layoutMarginCards(
  input: readonly CardInput[],
  options: LayoutOptions = {},
): LayoutResult {
  const gap = options.gap ?? 8;
  const minTop = options.minTop ?? 0;

  const sorted = [...input].sort((a, b) => {
    if (a.idealTop !== b.idealTop) return a.idealTop - b.idealTop;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const cards: PlacedCard[] = [];
  let cursor = minTop;
  for (const card of sorted) {
    const top = Math.max(card.idealTop, cursor);
    cards.push({
      id: card.id,
      top,
      height: card.height,
      displacement: top - card.idealTop,
    });
    cursor = top + card.height + gap;
  }

  // contentHeight is the bottom of the last card (no trailing gap).
  const last = cards[cards.length - 1];
  const contentHeight = last ? last.top + last.height : minTop;
  const overflow =
    options.availableHeight !== undefined && contentHeight > options.availableHeight;

  return { cards, contentHeight, overflow };
}
