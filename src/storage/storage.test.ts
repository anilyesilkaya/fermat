/**
 * @vitest-environment happy-dom
 *
 * Uses fake-indexeddb to exercise the real transaction logic in Node. This is a
 * faithful IndexedDB implementation, so the concurrency/transaction guarantees
 * tested here are the same ones the browser enforces.
 */
import { beforeEach, describe, it, expect } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import {
  createAnnotation,
  saveAnnotation,
  getAnnotation,
  listAnnotations,
  putDocument,
  getDocument,
  getPdfBytes,
  listDocuments,
  saveDraft,
  getDraft,
  clearDraft,
  RevisionConflictError,
} from './storage';
import { _resetDbForTests } from './db';
import type { Annotation, DocumentMeta } from '../model/schema';

const SHA = 'a'.repeat(64);
const NOW = '2026-01-01T00:00:00.000Z';

function doc(): DocumentMeta {
  return {
    schemaVersion: 1,
    id: '11111111-1111-4111-8111-111111111111',
    sha256: SHA,
    title: 'Doc',
    originalFilename: 'doc.pdf',
    byteSize: 3,
    pageCount: 1,
    sourceRevision: 1,
    tags: [],
    readingStatus: 'unread',
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function ann(overrides: Partial<Annotation> = {}): Annotation {
  return {
    schemaVersion: 1,
    id: '22222222-2222-4222-8222-222222222222',
    documentSha256: SHA,
    anchor: {
      kind: 'point',
      pageIndex: 0,
      pageViewBox: [0, 0, 612, 792],
      pageRotation: 0,
      userUnit: 1,
      coordinateSpace: 'pdf-user-space',
      point: [100, 700],
    },
    bodyMarkdown: 'body',
    color: '#ffe066',
    tags: [],
    createdAt: NOW,
    updatedAt: NOW,
    publication: 'private',
    revision: 1,
    ...overrides,
  };
}

beforeEach(() => {
  // Fresh in-memory IndexedDB per test.
  globalThis.indexedDB = new IDBFactory();
  _resetDbForTests();
});

describe('documents + blobs survive a reload', () => {
  it('stores PDF bytes and metadata, then reads them back on a new connection', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    await putDocument(doc(), bytes);

    // Simulate reload: drop cached connection, reopen.
    _resetDbForTests();

    const meta = await getDocument(doc().id);
    const stored = await getPdfBytes(doc().id);
    expect(meta?.title).toBe('Doc');
    expect(stored).toBeInstanceOf(Uint8Array);
    expect(Array.from(stored!)).toEqual([1, 2, 3]);
    expect(await listDocuments()).toHaveLength(1);
  });
});

describe('annotation persistence', () => {
  it('creates and lists annotations by document digest', async () => {
    await createAnnotation(ann());
    const list = await listAnnotations(SHA);
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(ann().id);
  });

  it('refuses to create a duplicate id', async () => {
    await createAnnotation(ann());
    await expect(createAnnotation(ann())).rejects.toBeInstanceOf(RevisionConflictError);
  });
});

describe('optimistic concurrency (two-tab conflict)', () => {
  it('saves when the base revision matches', async () => {
    await createAnnotation(ann({ revision: 1 }));
    await saveAnnotation(ann({ revision: 2, bodyMarkdown: 'edit A' }), 1);
    const stored = await getAnnotation(ann().id);
    expect(stored?.bodyMarkdown).toBe('edit A');
    expect(stored?.revision).toBe(2);
  });

  it('rejects a stale save without overwriting (second tab loses)', async () => {
    await createAnnotation(ann({ revision: 1 }));
    // Tab A commits r2.
    await saveAnnotation(ann({ revision: 2, bodyMarkdown: 'A wins' }), 1);
    // Tab B still thinks base is r1 and tries to write r2.
    await expect(
      saveAnnotation(ann({ revision: 2, bodyMarkdown: 'B clobbers' }), 1),
    ).rejects.toBeInstanceOf(RevisionConflictError);
    // A's text is preserved.
    const stored = await getAnnotation(ann().id);
    expect(stored?.bodyMarkdown).toBe('A wins');
  });

  it('rejects saving a missing annotation', async () => {
    await expect(saveAnnotation(ann({ revision: 2 }), 1)).rejects.toBeInstanceOf(
      RevisionConflictError,
    );
  });

  it('rejects a next.revision that is not baseRevision+1', async () => {
    await createAnnotation(ann({ revision: 1 }));
    await expect(saveAnnotation(ann({ revision: 5 }), 1)).rejects.toThrow(/baseRevision\+1/);
  });
});

describe('drafts (recovery + debounce safety)', () => {
  it('stores and reads back a draft', async () => {
    await saveDraft({
      annotationId: ann().id,
      documentId: doc().id,
      bodyMarkdown: 'in progress',
      baseRevision: 1,
      updatedAt: '2026-01-01T00:00:01.000Z',
    });
    const d = await getDraft(ann().id);
    expect(d?.bodyMarkdown).toBe('in progress');
  });

  it('does not let an older debounced write overwrite a newer draft', async () => {
    const base = { annotationId: ann().id, documentId: doc().id, baseRevision: 1 };
    await saveDraft({ ...base, bodyMarkdown: 'newer', updatedAt: '2026-01-01T00:00:05.000Z' });
    // A delayed (stale) debounced save arrives with an earlier timestamp.
    await saveDraft({ ...base, bodyMarkdown: 'older-stale', updatedAt: '2026-01-01T00:00:02.000Z' });
    const d = await getDraft(ann().id);
    expect(d?.bodyMarkdown).toBe('newer');
  });

  it('clears a draft', async () => {
    await saveDraft({
      annotationId: ann().id,
      documentId: doc().id,
      bodyMarkdown: 'x',
      baseRevision: 1,
      updatedAt: NOW,
    });
    await clearDraft(ann().id);
    expect(await getDraft(ann().id)).toBeUndefined();
  });
});
