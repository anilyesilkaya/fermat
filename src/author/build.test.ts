import { describe, it, expect } from 'vitest';
import { buildDocumentMeta, buildAnnotation, nextAnnotationRevision } from './build';
import type { Anchor } from '../model/schema';

const SHA = 'a'.repeat(64);
const NOW = '2026-01-02T03:04:05.000Z';
const LATER = '2026-01-02T03:10:00.000Z';

const textAnchor: Anchor = {
  kind: 'text',
  pageIndex: 0,
  pageViewBox: [0, 0, 612, 792],
  pageRotation: 0,
  userUnit: 1,
  coordinateSpace: 'pdf-user-space',
  quads: [[[10, 700], [100, 700], [100, 680], [10, 680]]],
};

describe('buildDocumentMeta', () => {
  it('builds a validated document at revision 1, unread', () => {
    const doc = buildDocumentMeta({
      id: '11111111-1111-4111-8111-111111111111',
      sha256: SHA,
      title: 'Paper',
      originalFilename: 'paper.pdf',
      byteSize: 12345,
      pageCount: 8,
      now: NOW,
    });
    expect(doc.sourceRevision).toBe(1);
    expect(doc.readingStatus).toBe('unread');
    expect(doc.createdAt).toBe(NOW);
    expect(doc.updatedAt).toBe(NOW);
  });
});

describe('buildAnnotation', () => {
  it('defaults to PRIVATE and revision 1', () => {
    const ann = buildAnnotation({
      id: '22222222-2222-4222-8222-222222222222',
      documentSha256: SHA,
      anchor: textAnchor,
      now: NOW,
    });
    expect(ann.publication).toBe('private');
    expect(ann.revision).toBe(1);
    expect(ann.bodyMarkdown).toBe('');
    expect(ann.color).toBe('#ffe066');
  });
});

describe('nextAnnotationRevision', () => {
  it('bumps revision by exactly one and refreshes updatedAt', () => {
    const base = buildAnnotation({
      id: '33333333-3333-4333-8333-333333333333',
      documentSha256: SHA,
      anchor: textAnchor,
      now: NOW,
    });
    const next = nextAnnotationRevision(base, { bodyMarkdown: 'hello' }, LATER);
    expect(next.revision).toBe(base.revision + 1);
    expect(next.updatedAt).toBe(LATER);
    expect(next.createdAt).toBe(NOW); // preserved
    expect(next.bodyMarkdown).toBe('hello');
    expect(next.id).toBe(base.id);
  });

  it('can flip publication to public without touching identity or anchor', () => {
    const base = buildAnnotation({
      id: '44444444-4444-4444-8444-444444444444',
      documentSha256: SHA,
      anchor: textAnchor,
      now: NOW,
    });
    const next = nextAnnotationRevision(base, { publication: 'public' }, LATER);
    expect(next.publication).toBe('public');
    expect(next.anchor).toEqual(base.anchor);
    expect(next.documentSha256).toBe(SHA);
  });

  it('preserves prior fields when the edit omits them', () => {
    const base = buildAnnotation({
      id: '55555555-5555-4555-8555-555555555555',
      documentSha256: SHA,
      anchor: textAnchor,
      bodyMarkdown: 'original',
      tags: ['keep'],
      now: NOW,
    });
    const next = nextAnnotationRevision(base, { color: '#ff0000' }, LATER);
    expect(next.bodyMarkdown).toBe('original');
    expect(next.tags).toEqual(['keep']);
    expect(next.color).toBe('#ff0000');
  });
});
