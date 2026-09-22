import { describe, it, expect } from 'vitest';
import { desiredLivePages, diffLivePages, maxLiveCount } from './virtualize';

describe('desiredLivePages', () => {
  it('returns visible range plus overscan, clamped to bounds', () => {
    expect(desiredLivePages({ first: 3, last: 4 }, 100, 1)).toEqual([2, 3, 4, 5]);
  });

  it('clamps at the start of the document', () => {
    expect(desiredLivePages({ first: 0, last: 0 }, 10, 2)).toEqual([0, 1, 2]);
  });

  it('clamps at the end of the document', () => {
    expect(desiredLivePages({ first: 9, last: 9 }, 10, 2)).toEqual([7, 8, 9]);
  });

  it('normalizes a reversed range', () => {
    expect(desiredLivePages({ first: 5, last: 3 }, 100, 0)).toEqual([3, 4, 5]);
  });

  it('returns nothing for an empty document', () => {
    expect(desiredLivePages({ first: 0, last: 0 }, 0, 1)).toEqual([]);
  });

  it('bounds the live set — a huge document never yields more than span+2*overscan', () => {
    // The "large PDF performance" guarantee: a 5000-page doc, single visible page,
    // overscan 2 → at most 5 live canvases, regardless of total pages.
    const live = desiredLivePages({ first: 2500, last: 2500 }, 5000, 2);
    expect(live).toHaveLength(5);
    expect(live.length).toBeLessThanOrEqual(maxLiveCount(1, 2));
  });
});

describe('diffLivePages', () => {
  it('computes mount/unmount as the set moves forward', () => {
    const diff = diffLivePages([2, 3, 4, 5], [3, 4, 5, 6]);
    expect(diff.toMount).toEqual([6]);
    expect(diff.toUnmount).toEqual([2]);
  });

  it('mounts everything when nothing is live', () => {
    const diff = diffLivePages([], [0, 1, 2]);
    expect(diff.toMount).toEqual([0, 1, 2]);
    expect(diff.toUnmount).toEqual([]);
  });

  it('unmounts everything when the desired set is empty', () => {
    const diff = diffLivePages([4, 5], []);
    expect(diff.toMount).toEqual([]);
    expect(diff.toUnmount).toEqual([4, 5]);
  });

  it('no-ops when current equals desired', () => {
    const diff = diffLivePages([1, 2, 3], [1, 2, 3]);
    expect(diff.toMount).toEqual([]);
    expect(diff.toUnmount).toEqual([]);
  });
});
