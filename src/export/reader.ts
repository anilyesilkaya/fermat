import { buildZip, textEntry, type ZipEntries } from './archive';
import { buildNotesMarkdown } from './notes-markdown';
import { projectPublic, type PublicProjection } from '../model/projection';
import type { Annotation, DocumentMeta } from '../model/schema';

/**
 * Published reader export.
 *
 * Produces a relocatable static directory (delivered as a ZIP):
 *   index.html               read-only reader entry point
 *   document.pdf             the selected source PDF
 *   manifest.json            allowlisted public manifest
 *   annotations.json         ONLY explicitly-public annotations
 *   assets/…                 versioned viewer code, PDF worker, CSS, math assets
 *   notes.md                 published-notes fallback (built from same data)
 *   THIRD_PARTY_NOTICES.txt  required notices for bundled software
 *
 * Every file is derived from the public projection (see model/projection), so
 * private notes, drafts, local paths, and authoring caches cannot appear. Output
 * is deterministic. This function does not touch IndexedDB or the DOM: the
 * author layer supplies the PDF bytes and the pre-built viewer assets, keeping
 * export logic pure and testable and keeping authoring code out of the reader.
 */

export const READER_INDEX_PATH = 'index.html';
export const READER_PDF_PATH = 'document.pdf';
export const READER_MANIFEST_PATH = 'manifest.json';
export const READER_ANNOTATIONS_PATH = 'annotations.json';
export const READER_NOTES_PATH = 'notes.md';
export const READER_NOTICES_PATH = 'THIRD_PARTY_NOTICES.txt';

export interface ExportReaderInput {
  document: DocumentMeta;
  /** All annotations for the document; private ones are filtered out here. */
  annotations: readonly Annotation[];
  /** The title the author approved for publication. */
  publishedTitle: string;
  pdfBytes: Uint8Array;
  /**
   * Pre-built viewer bundle: index.html plus assets/*, produced by the separate
   * viewer build (vite.viewer.config.ts). Keys are relative paths. index.html is
   * expected at 'index.html'; everything else typically under 'assets/'.
   */
  viewerBundle: ZipEntries;
  /** Third-party notices text for the bundled viewer/runtime software. */
  thirdPartyNotices: string;
}

export interface ExportReaderResult {
  zip: Uint8Array;
  projection: PublicProjection;
  /** The exact file map placed in the ZIP (handy for tests + preview). */
  files: ZipEntries;
}

function stableJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function exportReader(input: ExportReaderInput): ExportReaderResult {
  const projection = projectPublic(input.document, input.annotations, input.publishedTitle);

  const files: ZipEntries = {};

  // 1) Viewer bundle (index.html + assets). Copy verbatim; these are our own
  //    build artifacts. index.html must be present.
  let sawIndex = false;
  for (const [name, bytes] of Object.entries(input.viewerBundle)) {
    files[name] = bytes;
    if (name === READER_INDEX_PATH) sawIndex = true;
  }
  if (!sawIndex) {
    throw new Error('viewerBundle must include index.html');
  }

  // 2) Public data — manifest + annotations, both from the projection.
  files[READER_MANIFEST_PATH] = textEntry(stableJson(projection.manifest));
  files[READER_ANNOTATIONS_PATH] = textEntry(stableJson(projection.annotations));

  // 3) The source PDF.
  files[READER_PDF_PATH] = input.pdfBytes;

  // 4) notes.md fallback, from the same public data.
  files[READER_NOTES_PATH] = textEntry(
    buildNotesMarkdown(projection.manifest, projection.annotations),
  );

  // 5) Third-party notices.
  files[READER_NOTICES_PATH] = textEntry(input.thirdPartyNotices);

  return { zip: buildZip(files), projection, files };
}
