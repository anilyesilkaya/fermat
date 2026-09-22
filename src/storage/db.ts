import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Annotation, DocumentMeta, ReaderState } from '../model/schema';

/**
 * IndexedDB layout.
 *
 * Object stores:
 *   - documents:   DocumentMeta keyed by document id.
 *   - blobs:       raw PDF bytes keyed by document id, stored as a binary
 *                  Uint8Array — never base64 or localStorage. (Uint8Array is
 *                  what PDF.js and the export layer consume directly, and it
 *                  round-trips through IndexedDB's structured clone reliably.)
 *   - annotations: Annotation keyed by annotation id, indexed by documentId.
 *   - readerState: ReaderState keyed by document id (author's resume position).
 *   - drafts:      unsaved note buffers keyed by annotation id, for crash
 *                  recovery independent of the committed annotation.
 *
 * A single version constant governs schema upgrades. Because PDFs are large and
 * IndexedDB is the only promised local store, callers must handle quota errors
 * (see storage.ts) rather than assuming writes always succeed.
 */

export const DB_NAME = 'fermat';
export const DB_VERSION = 1;

/** A note draft: the in-progress body plus the base revision it was forked from. */
export interface Draft {
  annotationId: string;
  documentId: string;
  bodyMarkdown: string;
  /** Revision of the committed annotation this draft was started from. */
  baseRevision: number;
  updatedAt: string;
}

interface FermatDB extends DBSchema {
  documents: {
    key: string;
    value: DocumentMeta;
  };
  blobs: {
    key: string;
    value: Uint8Array;
  };
  annotations: {
    key: string;
    value: Annotation;
    indexes: { byDocument: string };
  };
  readerState: {
    key: string;
    value: ReaderState;
  };
  drafts: {
    key: string;
    value: Draft;
    indexes: { byDocument: string };
  };
}

export type FermatDatabase = IDBPDatabase<FermatDB>;

let dbPromise: Promise<FermatDatabase> | undefined;

/** Open (and lazily cache) the database, creating stores on first use/upgrade. */
export function getDb(): Promise<FermatDatabase> {
  if (!dbPromise) {
    dbPromise = openDB<FermatDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('documents')) {
          db.createObjectStore('documents', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('blobs')) {
          db.createObjectStore('blobs');
        }
        if (!db.objectStoreNames.contains('annotations')) {
          const store = db.createObjectStore('annotations', { keyPath: 'id' });
          store.createIndex('byDocument', 'documentSha256');
        }
        if (!db.objectStoreNames.contains('readerState')) {
          db.createObjectStore('readerState', { keyPath: 'documentId' });
        }
        if (!db.objectStoreNames.contains('drafts')) {
          const store = db.createObjectStore('drafts', { keyPath: 'annotationId' });
          store.createIndex('byDocument', 'documentId');
        }
      },
    });
  }
  return dbPromise;
}

/** Test hook: drop the cached connection so a fresh in-memory DB can be opened. */
export function _resetDbForTests(): void {
  dbPromise = undefined;
}
