import { getDb, type Draft } from './db';
import type { Annotation, DocumentMeta, ReaderState } from '../model/schema';

/**
 * Persistence API over IndexedDB.
 *
 * Guarantees relevant to the product contract:
 *   - Saves are transactional; a failed write leaves prior committed state
 *     intact and surfaces an error (callers show an explicit "failed" state).
 *   - Optimistic concurrency: `saveAnnotation` requires the caller's expected
 *     base revision. If the stored revision moved on (e.g. another tab saved),
 *     it throws `RevisionConflictError` WITHOUT overwriting, and the caller can
 *     preserve the user's text (as a draft) and offer a merge/keep-both path.
 *   - Drafts are stored separately so an interrupted or conflicting edit is
 *     always recoverable.
 *   - Quota / disabled-storage failures throw `StorageQuotaError` /
 *     `StorageUnavailableError` rather than silently losing data.
 */

export class RevisionConflictError extends Error {
  constructor(
    readonly annotationId: string,
    readonly expectedRevision: number,
    readonly actualRevision: number,
  ) {
    super(
      `annotation ${annotationId} changed underneath this edit ` +
        `(expected r${expectedRevision}, found r${actualRevision})`,
    );
    this.name = 'RevisionConflictError';
  }
}

export class StorageQuotaError extends Error {
  constructor(cause?: unknown) {
    super('browser storage quota exceeded');
    this.name = 'StorageQuotaError';
    if (cause !== undefined) this.cause = cause;
  }
}

export class StorageUnavailableError extends Error {
  constructor(cause?: unknown) {
    super('browser storage is unavailable (disabled or private-browsing limits)');
    this.name = 'StorageUnavailableError';
    if (cause !== undefined) this.cause = cause;
  }
}

/** Classify a raw IndexedDB error into a typed storage error and rethrow. */
function rethrowStorageError(err: unknown): never {
  const name = (err as { name?: string } | null)?.name;
  if (name === 'QuotaExceededError') throw new StorageQuotaError(err);
  if (name === 'InvalidStateError' || name === 'SecurityError') {
    throw new StorageUnavailableError(err);
  }
  throw err;
}

// --- Documents + blobs ------------------------------------------------------

/** Create/replace a document's metadata and (optionally) its immutable bytes. */
export async function putDocument(meta: DocumentMeta, pdfBytes?: Uint8Array): Promise<void> {
  try {
    const db = await getDb();
    const tx = db.transaction(['documents', 'blobs'], 'readwrite');
    await tx.objectStore('documents').put(meta);
    if (pdfBytes) await tx.objectStore('blobs').put(pdfBytes, meta.id);
    await tx.done;
  } catch (err) {
    rethrowStorageError(err);
  }
}

export async function getDocument(id: string): Promise<DocumentMeta | undefined> {
  const db = await getDb();
  return db.get('documents', id);
}

export async function listDocuments(): Promise<DocumentMeta[]> {
  const db = await getDb();
  return db.getAll('documents');
}

export async function getPdfBytes(id: string): Promise<Uint8Array | undefined> {
  const db = await getDb();
  return db.get('blobs', id);
}

/** Wrap stored PDF bytes as a Blob for download / object-URL use in the app. */
export async function getPdfBlob(id: string): Promise<Blob | undefined> {
  const bytes = await getPdfBytes(id);
  return bytes ? new Blob([bytes], { type: 'application/pdf' }) : undefined;
}

export async function deleteDocument(id: string, documentSha256: string): Promise<void> {
  try {
    const db = await getDb();
    const tx = db.transaction(['documents', 'blobs', 'annotations', 'readerState', 'drafts'], 'readwrite');
    await tx.objectStore('documents').delete(id);
    await tx.objectStore('blobs').delete(id);
    await tx.objectStore('readerState').delete(id);
    // Remove this document's annotations + their drafts.
    const annIndex = tx.objectStore('annotations').index('byDocument');
    for await (const cursor of annIndex.iterate(documentSha256)) {
      await tx.objectStore('drafts').delete(cursor.value.id);
      await cursor.delete();
    }
    await tx.done;
  } catch (err) {
    rethrowStorageError(err);
  }
}

// --- Annotations (optimistic concurrency) -----------------------------------

export async function listAnnotations(documentSha256: string): Promise<Annotation[]> {
  const db = await getDb();
  return db.getAllFromIndex('annotations', 'byDocument', documentSha256);
}

export async function getAnnotation(id: string): Promise<Annotation | undefined> {
  const db = await getDb();
  return db.get('annotations', id);
}

/**
 * Insert a brand-new annotation (revision must be 1 and id must be unused).
 * Throws if an annotation with the same id already exists.
 */
export async function createAnnotation(annotation: Annotation): Promise<void> {
  try {
    const db = await getDb();
    const tx = db.transaction('annotations', 'readwrite');
    const existing = await tx.store.get(annotation.id);
    if (existing) {
      throw new RevisionConflictError(annotation.id, 0, existing.revision);
    }
    await tx.store.add(annotation);
    await tx.done;
  } catch (err) {
    if (err instanceof RevisionConflictError) throw err;
    rethrowStorageError(err);
  }
}

/**
 * Update an existing annotation with optimistic concurrency.
 *
 * @param next             the new annotation value; its `revision` must be
 *                         `expectedBaseRevision + 1`.
 * @param expectedBaseRevision  the revision the editor started from.
 *
 * The whole read-check-write happens inside ONE readwrite transaction, so two
 * tabs racing cannot both believe they won: the second sees the bumped revision
 * and gets a RevisionConflictError instead of clobbering.
 */
export async function saveAnnotation(
  next: Annotation,
  expectedBaseRevision: number,
): Promise<void> {
  try {
    const db = await getDb();
    const tx = db.transaction('annotations', 'readwrite');
    const current = await tx.store.get(next.id);
    if (!current) {
      throw new RevisionConflictError(next.id, expectedBaseRevision, 0);
    }
    if (current.revision !== expectedBaseRevision) {
      throw new RevisionConflictError(next.id, expectedBaseRevision, current.revision);
    }
    if (next.revision !== expectedBaseRevision + 1) {
      throw new Error(
        `saveAnnotation expects next.revision (${next.revision}) to be baseRevision+1 (${expectedBaseRevision + 1})`,
      );
    }
    await tx.store.put(next);
    await tx.done;
  } catch (err) {
    if (err instanceof RevisionConflictError) throw err;
    rethrowStorageError(err);
  }
}

export async function deleteAnnotation(id: string): Promise<void> {
  try {
    const db = await getDb();
    const tx = db.transaction(['annotations', 'drafts'], 'readwrite');
    await tx.objectStore('annotations').delete(id);
    await tx.objectStore('drafts').delete(id);
    await tx.done;
  } catch (err) {
    rethrowStorageError(err);
  }
}

// --- Drafts (crash / conflict recovery) -------------------------------------

/**
 * Save a draft body. Debounce-safe: callers pass a monotonically increasing
 * `updatedAt`, and we refuse to overwrite a newer draft with an older one so a
 * delayed debounced write cannot clobber a more recent keystroke's draft.
 */
export async function saveDraft(draft: Draft): Promise<void> {
  try {
    const db = await getDb();
    const tx = db.transaction('drafts', 'readwrite');
    const current = await tx.store.get(draft.annotationId);
    if (current && current.updatedAt > draft.updatedAt) {
      // A newer draft already exists; drop this stale write.
      await tx.done;
      return;
    }
    await tx.store.put(draft);
    await tx.done;
  } catch (err) {
    rethrowStorageError(err);
  }
}

export async function getDraft(annotationId: string): Promise<Draft | undefined> {
  const db = await getDb();
  return db.get('drafts', annotationId);
}

export async function clearDraft(annotationId: string): Promise<void> {
  try {
    const db = await getDb();
    await db.delete('drafts', annotationId);
  } catch (err) {
    rethrowStorageError(err);
  }
}

// --- Reader state -----------------------------------------------------------

export async function putReaderState(state: ReaderState): Promise<void> {
  try {
    const db = await getDb();
    await db.put('readerState', state);
  } catch (err) {
    rethrowStorageError(err);
  }
}

export async function getReaderState(documentId: string): Promise<ReaderState | undefined> {
  const db = await getDb();
  return db.get('readerState', documentId);
}

// --- Persistent-storage request (best effort) -------------------------------

/**
 * Ask the browser to make storage persistent. Refusal is non-fatal — Fermat
 * still works and can always export. Returns whether persistence is granted.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
      if (await navigator.storage.persisted()) return true;
      return await navigator.storage.persist();
    }
  } catch {
    // ignore — treat as not persisted
  }
  return false;
}
