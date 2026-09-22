import { describe, it, expect } from 'vitest';
import { projectPublic } from './projection';
import type { Annotation, DocumentMeta } from './schema';

const SHA = 'a'.repeat(64);
const NOW = '2026-01-01T00:00:00.000Z';

function doc(overrides: Partial<DocumentMeta> = {}): DocumentMeta {
  return {
    schemaVersion: 1,
    id: '11111111-1111-4111-8111-111111111111',
    sha256: SHA,
    title: 'Private working title',
    originalFilename: '/home/secret/path/paper-DRAFT.pdf',
    byteSize: 12345,
    pageCount: 10,
    sourceRevision: 2,
    tags: ['private-tag'],
    readingStatus: 'reading',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function ann(overrides: Partial<Annotation> = {}): Annotation {
  return {
    schemaVersion: 1,
    id: '22222222-2222-4222-8222-222222222222',
    documentSha256: SHA,
    anchor: {
      kind: 'text',
      pageIndex: 3,
      pageViewBox: [0, 0, 612, 792],
      pageRotation: 0,
      userUnit: 1,
      coordinateSpace: 'pdf-user-space',
      quads: [
        [
          [72, 650],
          [240, 650],
          [240, 635],
          [72, 635],
        ],
      ],
    },
    bodyMarkdown: 'public note body',
    color: '#ffe066',
    tags: ['topic'],
    createdAt: NOW,
    updatedAt: NOW,
    publication: 'public',
    revision: 1,
    ...overrides,
  };
}

describe('projectPublic — anti-leak allowlist', () => {
  it('includes only public annotations', () => {
    const annotations = [
      ann({ id: '22222222-2222-4222-8222-222222222222', publication: 'public' }),
      ann({ id: '33333333-3333-4333-8333-333333333333', publication: 'private' }),
    ];
    const out = projectPublic(doc(), annotations, 'Published Title');
    expect(out.annotations.map((a) => a.id)).toEqual([
      '22222222-2222-4222-8222-222222222222',
    ]);
  });

  it('never carries private note bodies into the projection', () => {
    const SENTINEL = 'PRIVATE-SENTINEL-DO-NOT-PUBLISH';
    const annotations = [
      ann({ publication: 'private', bodyMarkdown: SENTINEL }),
      ann({ id: '44444444-4444-4444-8444-444444444444', publication: 'public' }),
    ];
    const out = projectPublic(doc(), annotations, 'Published Title');
    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain(SENTINEL);
  });

  it('drops document fields that are not on the allowlist', () => {
    const out = projectPublic(doc(), [ann()], 'Published Title');
    const serialized = JSON.stringify(out);
    // originalFilename / local path / private tags / reading status must be gone.
    expect(serialized).not.toContain('/home/secret/path');
    expect(serialized).not.toContain('paper-DRAFT.pdf');
    expect(serialized).not.toContain('private-tag');
    expect(serialized).not.toContain('Private working title');
    // Uses the author-approved published title instead.
    expect(out.manifest.title).toBe('Published Title');
  });

  it('projected annotation has exactly the allowlisted keys', () => {
    const out = projectPublic(doc(), [ann()], 'T');
    expect(Object.keys(out.annotations[0]!).sort()).toEqual(
      ['anchor', 'bodyMarkdown', 'color', 'documentSha256', 'id', 'schemaVersion', 'tags'].sort(),
    );
    // No createdAt/updatedAt/publication/revision fields.
    expect(out.annotations[0]).not.toHaveProperty('createdAt');
    expect(out.annotations[0]).not.toHaveProperty('publication');
    expect(out.annotations[0]).not.toHaveProperty('revision');
  });

  it('is deterministic: same input → identical JSON, sorted by page then position', () => {
    const a = ann({
      id: 'aaaaaaaa-0000-4000-8000-000000000000',
      anchor: { ...ann().anchor, pageIndex: 5 } as Annotation['anchor'],
    });
    const b = ann({
      id: 'bbbbbbbb-0000-4000-8000-000000000000',
      anchor: { ...ann().anchor, pageIndex: 1 } as Annotation['anchor'],
    });
    const out1 = projectPublic(doc(), [a, b], 'T');
    const out2 = projectPublic(doc(), [b, a], 'T');
    expect(JSON.stringify(out1)).toBe(JSON.stringify(out2));
    // Page 1 sorts before page 5.
    expect(out1.annotations[0]!.anchor.pageIndex).toBe(1);
  });

  it('copies tag arrays rather than sharing references', () => {
    const source = ann();
    const out = projectPublic(doc(), [source], 'T');
    expect(out.annotations[0]!.tags).not.toBe(source.tags);
    expect(out.annotations[0]!.tags).toEqual(source.tags);
  });
});
