import { Annotation, DocumentMeta, SCHEMA_VERSION } from '../model/schema';
import type { Anchor } from '../model/schema';

/**
 * Pure constructors for the authoring model.
 *
 * These take the nondeterministic inputs (id, timestamps) as ARGUMENTS rather
 * than calling the clock/uuid directly, so they are fully deterministic and
 * unit-testable. The DOM layer wires in `newUuid`/`nowIso` from ./ids.
 *
 * Every result is parsed through the zod schema before returning, so an invalid
 * object can never reach storage or export — the schema is the single gate.
 */

export interface NewDocumentInput {
  id: string;
  sha256: string;
  title: string;
  originalFilename: string;
  byteSize: number;
  pageCount: number;
  now: string;
}

/** Build validated DocumentMeta for a freshly imported PDF. */
export function buildDocumentMeta(input: NewDocumentInput): DocumentMeta {
  return DocumentMeta.parse({
    schemaVersion: SCHEMA_VERSION,
    id: input.id,
    sha256: input.sha256,
    title: input.title,
    originalFilename: input.originalFilename,
    byteSize: input.byteSize,
    pageCount: input.pageCount,
    sourceRevision: 1,
    tags: [],
    readingStatus: 'unread',
    createdAt: input.now,
    updatedAt: input.now,
  });
}

export interface NewAnnotationInput {
  id: string;
  documentSha256: string;
  anchor: Anchor;
  bodyMarkdown?: string;
  color?: string;
  tags?: string[];
  now: string;
}

/**
 * Build a validated, brand-new annotation. Publication is ALWAYS 'private' here
 * — a note becomes public only through an explicit later edit, never at birth.
 * revision starts at 1 (matches createAnnotation's precondition).
 */
export function buildAnnotation(input: NewAnnotationInput): Annotation {
  return Annotation.parse({
    schemaVersion: SCHEMA_VERSION,
    id: input.id,
    documentSha256: input.documentSha256,
    anchor: input.anchor,
    bodyMarkdown: input.bodyMarkdown ?? '',
    ...(input.color ? { color: input.color } : {}),
    tags: input.tags ?? [],
    createdAt: input.now,
    updatedAt: input.now,
    publication: 'private',
    revision: 1,
  });
}

/** Fields an edit may change. Absent fields are left as-is. */
export interface AnnotationEdit {
  bodyMarkdown?: string;
  color?: string;
  tags?: string[];
  publication?: 'private' | 'public';
}

/**
 * Produce the next revision of an annotation from a base + an edit.
 *
 * The revision is bumped by exactly one and `updatedAt` is refreshed, matching
 * `saveAnnotation`'s optimistic-concurrency precondition (next.revision must be
 * base.revision + 1). Identity, source binding, creation time, and anchor are
 * preserved. Returns the validated next value.
 */
export function nextAnnotationRevision(
  base: Annotation,
  edit: AnnotationEdit,
  now: string,
): Annotation {
  return Annotation.parse({
    ...base,
    bodyMarkdown: edit.bodyMarkdown ?? base.bodyMarkdown,
    color: edit.color ?? base.color,
    tags: edit.tags ?? base.tags,
    publication: edit.publication ?? base.publication,
    updatedAt: now,
    revision: base.revision + 1,
  });
}
