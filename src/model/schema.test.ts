import { describe, it, expect } from 'vitest';
import { Annotation, DocumentMeta, ProjectFile, Sha256, Uuid } from './schema';
import { migrateProjectFile, SchemaMigrationError } from './migrate';
import { normalizeQuoteText, codePointLength } from './normalize';

const SHA = 'f'.repeat(64);
const NOW = '2026-01-01T00:00:00.000Z';

const validAnnotation = {
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
  bodyMarkdown: 'note',
  color: '#ffe066',
  tags: [],
  createdAt: NOW,
  updatedAt: NOW,
  publication: 'private',
  revision: 1,
};

describe('primitive schemas', () => {
  it('accepts a 64-hex sha and rejects wrong length/case', () => {
    expect(Sha256.safeParse(SHA).success).toBe(true);
    expect(Sha256.safeParse('F'.repeat(64)).success).toBe(false); // uppercase
    expect(Sha256.safeParse('f'.repeat(63)).success).toBe(false);
  });

  it('accepts a UUID and rejects a plain string', () => {
    expect(Uuid.safeParse('22222222-2222-4222-8222-222222222222').success).toBe(true);
    expect(Uuid.safeParse('not-a-uuid').success).toBe(false);
  });
});

describe('Annotation schema', () => {
  it('parses a valid text annotation', () => {
    expect(Annotation.safeParse(validAnnotation).success).toBe(true);
  });

  it('rejects a non-quarter-turn rotation', () => {
    const bad = { ...validAnnotation, anchor: { ...validAnnotation.anchor, pageRotation: 45 } };
    expect(Annotation.safeParse(bad).success).toBe(false);
  });

  it('rejects NaN in a vertex', () => {
    const bad = {
      ...validAnnotation,
      anchor: {
        ...validAnnotation.anchor,
        quads: [[[Number.NaN, 0], [1, 0], [1, 1], [0, 1]]],
      },
    };
    expect(Annotation.safeParse(bad).success).toBe(false);
  });

  it('requires four vertices per quad', () => {
    const bad = {
      ...validAnnotation,
      anchor: { ...validAnnotation.anchor, quads: [[[0, 0], [1, 0], [1, 1]]] },
    };
    expect(Annotation.safeParse(bad).success).toBe(false);
  });

  it('applies defaults for color/tags/publication/revision', () => {
    const minimal = { ...validAnnotation };
    // Remove defaulted fields.
    delete (minimal as Record<string, unknown>).color;
    delete (minimal as Record<string, unknown>).tags;
    delete (minimal as Record<string, unknown>).publication;
    delete (minimal as Record<string, unknown>).revision;
    const parsed = Annotation.parse(minimal);
    expect(parsed.color).toBe('#ffe066');
    expect(parsed.tags).toEqual([]);
    expect(parsed.publication).toBe('private');
    expect(parsed.revision).toBe(1);
  });
});

describe('migrateProjectFile', () => {
  const validDoc = {
    schemaVersion: 1,
    id: '11111111-1111-4111-8111-111111111111',
    sha256: SHA,
    title: 'T',
    originalFilename: 'f.pdf',
    byteSize: 1,
    pageCount: 1,
    sourceRevision: 1,
    tags: [],
    readingStatus: 'unread',
    createdAt: NOW,
    updatedAt: NOW,
  };

  it('validates a current-version project file', () => {
    const file = { schemaVersion: 1, document: validDoc, annotations: [validAnnotation] };
    expect(() => migrateProjectFile(file)).not.toThrow();
    // Sanity: DocumentMeta and ProjectFile agree.
    expect(DocumentMeta.safeParse(validDoc).success).toBe(true);
    expect(ProjectFile.safeParse(file).success).toBe(true);
  });

  it('throws SchemaMigrationError when version is missing', () => {
    expect(() => migrateProjectFile({ document: validDoc, annotations: [] })).toThrow(
      SchemaMigrationError,
    );
  });

  it('throws SchemaMigrationError for a future version', () => {
    expect(() =>
      migrateProjectFile({ schemaVersion: 999, document: validDoc, annotations: [] }),
    ).toThrow(SchemaMigrationError);
  });

  it('throws ZodError (not migration error) for structural problems at the current version', () => {
    const bad = { schemaVersion: 1, document: { ...validDoc, sha256: 'nope' }, annotations: [] };
    expect(() => migrateProjectFile(bad)).toThrow();
    expect(() => migrateProjectFile(bad)).not.toThrow(SchemaMigrationError);
  });
});

describe('normalizeQuoteText', () => {
  it('collapses whitespace and trims', () => {
    expect(normalizeQuoteText('  a\n\t  b   c ')).toBe('a b c');
  });

  it('applies NFC so composed and decomposed forms match', () => {
    const composed = 'é'; // é
    const decomposed = 'é'; // e + combining acute
    expect(normalizeQuoteText(composed)).toBe(normalizeQuoteText(decomposed));
  });

  it('codePointLength counts code points, not UTF-16 units', () => {
    // A code point outside the BMP is 2 UTF-16 units but 1 code point.
    expect('𝑥'.length).toBe(2);
    expect(codePointLength('𝑥')).toBe(1);
  });
});
