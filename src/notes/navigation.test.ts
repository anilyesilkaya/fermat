import { describe, it, expect } from 'vitest';
import { parseDeepLink, serializeDeepLink, pageLabel } from './navigation';

describe('parseDeepLink', () => {
  it('parses page (1-based) into a 0-based index', () => {
    expect(parseDeepLink('#page=4').pageIndex).toBe(3);
  });

  it('parses page and note together', () => {
    const link = parseDeepLink('#page=4&note=22222222-2222-4222-8222-222222222222');
    expect(link.pageIndex).toBe(3);
    expect(link.noteId).toBe('22222222-2222-4222-8222-222222222222');
  });

  it('tolerates a missing leading #', () => {
    expect(parseDeepLink('page=2').pageIndex).toBe(1);
  });

  it('ignores an invalid page number', () => {
    expect(parseDeepLink('#page=0').pageIndex).toBeUndefined();
    expect(parseDeepLink('#page=-1').pageIndex).toBeUndefined();
    expect(parseDeepLink('#page=abc').pageIndex).toBeUndefined();
  });

  it('ignores a non-UUID note id', () => {
    expect(parseDeepLink('#note=not-a-uuid').noteId).toBeUndefined();
  });

  it('lowercases the note id', () => {
    const link = parseDeepLink('#note=22222222-2222-4222-8222-2222222222AB');
    expect(link.noteId).toBe('22222222-2222-4222-8222-2222222222ab');
  });
});

describe('serializeDeepLink', () => {
  it('serializes a 0-based index to a 1-based page', () => {
    expect(serializeDeepLink({ pageIndex: 3 })).toBe('#page=4');
  });

  it('round-trips with parseDeepLink', () => {
    const original = { pageIndex: 3, noteId: '22222222-2222-4222-8222-222222222222' };
    const parsed = parseDeepLink(serializeDeepLink(original));
    expect(parsed).toEqual(original);
  });

  it('returns an empty string for an empty link', () => {
    expect(serializeDeepLink({})).toBe('');
  });
});

describe('pageLabel', () => {
  it('shows 1-based labels', () => {
    expect(pageLabel(0)).toBe(1);
    expect(pageLabel(3)).toBe(4);
  });
});
