import { describe, it, expect } from 'vitest';
import { safeEntryPath, SizeGuard, UnsafeZipEntryError, ZipSizeLimitError } from './zip-safety';
import { buildZip, readZipSafe, textEntry, entryToText } from './archive';
import { exportProject, importProject, ProjectImportError } from './project';
import { exportReader } from './reader';
import { buildNotesMarkdown } from './notes-markdown';
import { preflightPublication } from './preflight';
import { sha256Hex } from '../model/hash';
import type { Annotation, DocumentMeta } from '../model/schema';

const NOW = '2026-01-01T00:00:00.000Z';

async function makeDoc(pdfBytes: Uint8Array, overrides: Partial<DocumentMeta> = {}): Promise<DocumentMeta> {
  return {
    schemaVersion: 1,
    id: '11111111-1111-4111-8111-111111111111',
    sha256: await sha256Hex(pdfBytes),
    title: 'Private Title',
    originalFilename: '/Users/me/secret/draft.pdf',
    byteSize: pdfBytes.length,
    pageCount: 2,
    sourceRevision: 1,
    tags: ['secret-tag'],
    readingStatus: 'reading',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function textAnn(overrides: Partial<Annotation> = {}): Annotation {
  return {
    schemaVersion: 1,
    id: '22222222-2222-4222-8222-222222222222',
    documentSha256: 'a'.repeat(64),
    anchor: {
      kind: 'text',
      pageIndex: 0,
      pageViewBox: [0, 0, 612, 792],
      pageRotation: 0,
      userUnit: 1,
      coordinateSpace: 'pdf-user-space',
      quads: [[[72, 650], [240, 650], [240, 635], [72, 635]]],
    },
    bodyMarkdown: 'public body',
    color: '#ffe066',
    tags: ['topic'],
    createdAt: NOW,
    updatedAt: NOW,
    publication: 'public',
    revision: 1,
    ...overrides,
  };
}

describe('zip-safety: path traversal', () => {
  it('rejects parent traversal', () => {
    expect(() => safeEntryPath('../../etc/passwd')).toThrow(UnsafeZipEntryError);
  });
  it('rejects absolute posix paths', () => {
    expect(() => safeEntryPath('/etc/passwd')).toThrow(UnsafeZipEntryError);
  });
  it('rejects drive-letter paths', () => {
    expect(() => safeEntryPath('C:\\Windows\\system32')).toThrow(UnsafeZipEntryError);
  });
  it('normalizes backslashes and collapses . segments', () => {
    expect(safeEntryPath('a\\b\\.\\c')).toBe('a/b/c');
  });
  it('rejects control characters', () => {
    expect(() => safeEntryPath('a\u0000b')).toThrow(UnsafeZipEntryError);
  });
});

describe('zip-safety: size guard', () => {
  it('throws when an entry exceeds the per-entry budget', () => {
    const guard = new SizeGuard({ maxEntryBytes: 10, maxTotalBytes: 100 });
    expect(() => guard.add('big', 11)).toThrow(ZipSizeLimitError);
  });
  it('throws when total exceeds the budget', () => {
    const guard = new SizeGuard({ maxEntryBytes: 100, maxTotalBytes: 15 });
    guard.add('a', 10);
    expect(() => guard.add('b', 10)).toThrow(ZipSizeLimitError);
  });
});

describe('archive round-trip + determinism', () => {
  it('builds and reads back entries', () => {
    const zip = buildZip({ 'a.txt': textEntry('hello'), 'b.txt': textEntry('world') });
    const back = readZipSafe(zip);
    expect(entryToText(back['a.txt']!)).toBe('hello');
    expect(entryToText(back['b.txt']!)).toBe('world');
  });

  it('is byte-identical for identical content (no timestamp churn)', () => {
    const a = buildZip({ 'x.txt': textEntry('same') });
    const b = buildZip({ 'x.txt': textEntry('same') });
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it('readZipSafe rejects a malicious entry name', () => {
    const evil = buildZip({ 'ok.txt': textEntry('ok') });
    // Manually craft a bad archive by reusing buildZip with a traversal name.
    const badZip = buildZip({ '../evil.txt': textEntry('x') });
    expect(() => readZipSafe(badZip)).toThrow(UnsafeZipEntryError);
    // Sanity: the good one still reads.
    expect(readZipSafe(evil)['ok.txt']).toBeDefined();
  });
});

describe('project backup round-trip', () => {
  it('exports and re-imports preserving ids, hash, geometry, notes', async () => {
    const pdf = new Uint8Array([1, 2, 3, 4, 5]);
    const doc = await makeDoc(pdf);
    const ann = textAnn({ documentSha256: doc.sha256 });
    const zip = await exportProject({ document: doc, annotations: [ann], pdfBytes: pdf });

    const imported = await importProject(zip);
    expect(imported.project.document.id).toBe(doc.id);
    expect(imported.project.document.sha256).toBe(doc.sha256);
    expect(imported.project.annotations[0]!.id).toBe(ann.id);
    expect(imported.project.annotations[0]!.anchor).toEqual(ann.anchor);
    expect(imported.project.annotations[0]!.bodyMarkdown).toBe('public body');
    expect(Array.from(imported.pdfBytes)).toEqual(Array.from(pdf));
  });

  it('fails clearly on a PDF hash mismatch', async () => {
    const pdf = new Uint8Array([1, 2, 3]);
    const doc = await makeDoc(pdf, { sha256: 'b'.repeat(64) }); // wrong hash
    const zip = await exportProject({ document: doc, annotations: [], pdfBytes: pdf });
    await expect(importProject(zip)).rejects.toThrow(/hash mismatch/);
  });

  it('fails clearly on an unsupported schema version', async () => {
    const pdf = new Uint8Array([9]);
    const doc = await makeDoc(pdf);
    const zip = await exportProject({ document: doc, annotations: [], pdfBytes: pdf });
    // Tamper: bump schemaVersion in project.json.
    const entries = readZipSafe(zip);
    const project = JSON.parse(entryToText(entries['project.json']!));
    project.schemaVersion = 999;
    entries['project.json'] = textEntry(JSON.stringify(project));
    const tampered = buildZip(entries);
    await expect(importProject(tampered)).rejects.toBeInstanceOf(ProjectImportError);
  });
});

describe('published reader export — no private leak', () => {
  const PRIVATE_SENTINEL = 'PRIVATE-SENTINEL-XYZZY';

  async function exportWithMixedNotes() {
    const pdf = new Uint8Array([10, 20, 30]);
    const doc = await makeDoc(pdf);
    const publicNote = textAnn({
      id: '22222222-2222-4222-8222-222222222222',
      documentSha256: doc.sha256,
      publication: 'public',
      bodyMarkdown: 'this is public',
    });
    const privateNote = textAnn({
      id: '33333333-3333-4333-8333-333333333333',
      documentSha256: doc.sha256,
      publication: 'private',
      bodyMarkdown: PRIVATE_SENTINEL,
      tags: ['secret-tag'],
    });
    return exportReader({
      document: doc,
      annotations: [publicNote, privateNote],
      publishedTitle: 'Public Title',
      pdfBytes: pdf,
      viewerBundle: {
        'index.html': textEntry('<!doctype html><title>reader</title>'),
        'assets/viewer.js': textEntry('// viewer'),
      },
      thirdPartyNotices: 'PDF.js — Apache-2.0\nfflate — MIT',
    });
  }

  it('the private sentinel appears in NO exported text file', async () => {
    const { files } = await exportWithMixedNotes();
    for (const [name, bytes] of Object.entries(files)) {
      // Only meaningful for text-ish files; PDF bytes here are our fake array.
      const text = entryToText(bytes);
      expect(text, `sentinel leaked into ${name}`).not.toContain(PRIVATE_SENTINEL);
    }
  });

  it('the private title/filename/tags do not leak', async () => {
    const { files } = await exportWithMixedNotes();
    const all = Object.values(files).map(entryToText).join('\n');
    expect(all).not.toContain('Private Title');
    expect(all).not.toContain('/Users/me/secret/draft.pdf');
    expect(all).not.toContain('secret-tag');
  });

  it('annotations.json contains only the public note', async () => {
    const { files } = await exportWithMixedNotes();
    const ann = JSON.parse(entryToText(files['annotations.json']!));
    expect(ann).toHaveLength(1);
    expect(ann[0].id).toBe('22222222-2222-4222-8222-222222222222');
  });

  it('includes all required reader files', async () => {
    const { files } = await exportWithMixedNotes();
    for (const p of [
      'index.html',
      'assets/viewer.js',
      'manifest.json',
      'annotations.json',
      'document.pdf',
      'notes.md',
      'THIRD_PARTY_NOTICES.txt',
    ]) {
      expect(files[p], `missing ${p}`).toBeDefined();
    }
  });

  it('throws if the viewer bundle lacks index.html', async () => {
    const pdf = new Uint8Array([1]);
    const doc = await makeDoc(pdf);
    expect(() =>
      exportReader({
        document: doc,
        annotations: [],
        publishedTitle: 'T',
        pdfBytes: pdf,
        viewerBundle: { 'assets/viewer.js': textEntry('x') },
        thirdPartyNotices: 'x',
      }),
    ).toThrow(/index\.html/);
  });

  it('notes.md is built from public data only', async () => {
    const { files } = await exportWithMixedNotes();
    const md = entryToText(files['notes.md']!);
    expect(md).toContain('this is public');
    expect(md).not.toContain(PRIVATE_SENTINEL);
    expect(md).toContain('Public Title');
  });
});

describe('buildNotesMarkdown', () => {
  it('groups by page with 1-based labels and deep links', () => {
    const md = buildNotesMarkdown(
      { schemaVersion: 1, viewerSchemaVersion: 1, title: 'T', source: { sha256: 'a'.repeat(64), pageCount: 5, sourceRevision: 1 } },
      [
        {
          schemaVersion: 1,
          id: '22222222-2222-4222-8222-222222222222',
          documentSha256: 'a'.repeat(64),
          anchor: { kind: 'point', pageIndex: 3, pageViewBox: [0, 0, 612, 792], pageRotation: 0, userUnit: 1, coordinateSpace: 'pdf-user-space', point: [1, 2] },
          bodyMarkdown: 'note text',
          color: '#ffe066',
          tags: [],
        },
      ],
    );
    expect(md).toContain('## Page 4'); // pageIndex 3 → label 4
    expect(md).toContain('#page=4&note=22222222-2222-4222-8222-222222222222');
  });
});

describe('preflight', () => {
  it('flags embedded comments and requires acknowledgement', () => {
    const report = preflightPublication({
      annotations: [textAnn({ publication: 'public' })],
      embeddedCommentCount: 2,
    });
    expect(report.embeddedCommentsPresent).toBe(true);
    expect(report.requiresAcknowledgement).toBe(true);
    expect(report.warnings.join(' ')).toMatch(/does not remove or redact/);
  });

  it('warns when nothing is publishable', () => {
    const report = preflightPublication({
      annotations: [textAnn({ publication: 'private' })],
      embeddedCommentCount: 0,
    });
    expect(report.hasPublishable).toBe(false);
    expect(report.requiresAcknowledgement).toBe(false);
  });
});
