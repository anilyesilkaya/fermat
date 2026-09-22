/**
 * Page virtualization bookkeeping.
 *
 * Deciding WHICH pages should have a live canvas is pure logic; the actual
 * render/teardown is the caller's job. Keeping this separate makes the
 * "bounded active canvas count" guarantee unit-testable: given the visible page
 * range and an overscan, `desiredLivePages` returns a bounded set, and
 * `diffLivePages` says what to mount/unmount so obsolete canvases are released.
 */

export interface VisibleRange {
  /** First page index intersecting the viewport (0-based). */
  first: number;
  /** Last page index intersecting the viewport (0-based, inclusive). */
  last: number;
}

/**
 * The set of page indices that should be live: the visible range plus `overscan`
 * pages on each side, clamped to [0, pageCount).
 */
export function desiredLivePages(
  visible: VisibleRange,
  pageCount: number,
  overscan = 1,
): number[] {
  if (pageCount <= 0) return [];
  const first = Math.max(0, Math.min(visible.first, visible.last));
  const last = Math.min(pageCount - 1, Math.max(visible.first, visible.last));
  const start = Math.max(0, first - overscan);
  const end = Math.min(pageCount - 1, last + overscan);
  const out: number[] = [];
  for (let i = start; i <= end; i++) out.push(i);
  return out;
}

export interface LiveDiff {
  /** Pages to render now (not currently live). */
  toMount: number[];
  /** Pages to tear down (currently live but no longer desired). */
  toUnmount: number[];
}

/** Compute mount/unmount sets from the current live set to the desired set. */
export function diffLivePages(current: Iterable<number>, desired: Iterable<number>): LiveDiff {
  const currentSet = new Set(current);
  const desiredSet = new Set(desired);
  const toMount: number[] = [];
  const toUnmount: number[] = [];
  for (const p of desiredSet) if (!currentSet.has(p)) toMount.push(p);
  for (const p of currentSet) if (!desiredSet.has(p)) toUnmount.push(p);
  toMount.sort((a, b) => a - b);
  toUnmount.sort((a, b) => a - b);
  return { toMount, toUnmount };
}

/** Upper bound on live canvases for a given visible span + overscan. */
export function maxLiveCount(visibleSpan: number, overscan: number): number {
  return visibleSpan + overscan * 2;
}
