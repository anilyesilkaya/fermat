import { sha256Hex } from '../model/hash';
import { PdfDocument } from '../pdf/document';
import { buildDocumentMeta } from './build';
import { listDocuments, putDocument } from '../storage/storage';
import { newUuid, nowIso } from './ids';
import type { DocumentMeta } from '../model/schema';

/**
 * PDF import.
 *
 * Identity is the SHA-256 of the exact bytes (never the filename). Before
 * storing, we open the PDF once to learn its page count and to fail fast on a
 * file PDF.js can't parse. If a document with the same digest already exists we
 * return it instead of creating a duplicate — re-importing the same paper keeps
 * one identity (and its existing notes).
 *
 * Title defaults to the filename stem; the author can rename later without
 * changing identity.
 */

export interface ImportResult {
  document: DocumentMeta;
  /** True if an identical PDF was already imported (bytes matched by digest). */
  duplicate: boolean;
}

/** Strip a trailing `.pdf` (case-insensitive) and surrounding whitespace. */
export function titleFromFilename(filename: string): string {
  return filename.replace(/\.pdf$/i, '').trim() || filename;
}

/**
 * Import raw PDF bytes. `bytes` must be the exact file contents. Opens the PDF
 * to validate + count pages, dedupes by digest, and persists metadata + bytes.
 */
export async function importPdfBytes(
  bytes: Uint8Array,
  originalFilename: string,
): Promise<ImportResult> {
  const sha256 = await sha256Hex(bytes);

  // Dedupe by content digest.
  const existing = (await listDocuments()).find((d) => d.sha256 === sha256);
  if (existing) return { document: existing, duplicate: true };

  // Validate + count pages. Throws if PDF.js cannot parse the file.
  let pageCount: number;
  const pdf = await PdfDocument.open(bytes);
  try {
    pageCount = pdf.pageCount;
  } finally {
    await pdf.close();
  }
  if (pageCount < 1) throw new Error('PDF has no pages');

  const document = buildDocumentMeta({
    id: newUuid(),
    sha256,
    title: titleFromFilename(originalFilename),
    originalFilename,
    byteSize: bytes.byteLength,
    pageCount,
    now: nowIso(),
  });

  await putDocument(document, bytes);
  return { document, duplicate: false };
}

/** Import from a File/Blob (reads bytes, then delegates to importPdfBytes). */
export async function importPdfFile(file: File): Promise<ImportResult> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return importPdfBytes(bytes, file.name);
}
