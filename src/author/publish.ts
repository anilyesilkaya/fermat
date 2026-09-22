import {
  exportReader,
  exportProject,
  preflightPublication,
  type ExportReaderResult,
  type PreflightReport,
  type ZipEntries,
} from '../export';
import { PdfDocument } from '../pdf/document';
import { getPdfBytes, listAnnotations } from '../storage/storage';
import type { Annotation, DocumentMeta } from '../model/schema';

/**
 * Author-side publication orchestration.
 *
 * This is the seam between stored (private) authoring data and the PURE
 * `exportReader`/`exportProject` functions. It loads the viewer bundle + notices
 * that `scripts/prepare-viewer.mjs` placed under /viewer/, gathers the document's
 * bytes + annotations, and hands everything to the export layer. It does not
 * itself decide what is public — projection does that from `publication` flags.
 */

const VIEWER_BASE = 'viewer';

interface ViewerBundleManifest {
  files: string[];
}

/** Fetch the pre-built viewer files (index.html + assets/*) as a ZipEntries map. */
export async function loadViewerBundle(base = VIEWER_BASE): Promise<ZipEntries> {
  const manifestUrl = new URL(`${base}/manifest.json`, document.baseURI).href;
  const res = await fetch(manifestUrl);
  if (!res.ok) throw new Error(`viewer bundle manifest missing (${res.status}); run the viewer build + prepare step`);
  const manifest = (await res.json()) as ViewerBundleManifest;

  const entries: ZipEntries = {};
  await Promise.all(
    manifest.files.map(async (rel) => {
      const url = new URL(`${base}/${rel}`, document.baseURI).href;
      const r = await fetch(url);
      if (!r.ok) throw new Error(`viewer asset ${rel} missing (${r.status})`);
      entries[rel] = new Uint8Array(await r.arrayBuffer());
    }),
  );
  return entries;
}

/** Fetch the prepared third-party notices text. */
export async function loadThirdPartyNotices(base = VIEWER_BASE): Promise<string> {
  const url = new URL(`${base}/THIRD_PARTY_NOTICES.txt`, document.baseURI).href;
  const res = await fetch(url);
  return res.ok ? res.text() : '(third-party notices unavailable)';
}

/** Run publication preflight for a document (counts + embedded-comment check). */
export async function runPreflight(document: DocumentMeta): Promise<PreflightReport> {
  const annotations = await listAnnotations(document.sha256);
  const bytes = await getPdfBytes(document.id);
  let embeddedCommentCount = 0;
  if (bytes) {
    const pdf = await PdfDocument.open(bytes);
    try {
      embeddedCommentCount = await pdf.countEmbeddedComments();
    } finally {
      await pdf.close();
    }
  }
  return preflightPublication({ annotations, embeddedCommentCount });
}

export interface PublishOptions {
  publishedTitle?: string;
  /** Pre-fetched to avoid re-downloading across preview/export; optional. */
  viewerBundle?: ZipEntries;
  thirdPartyNotices?: string;
}

/**
 * Build the published reader ZIP for a document. Only public annotations reach
 * the output (enforced by projectPublic inside exportReader).
 */
export async function publishReader(
  document: DocumentMeta,
  options: PublishOptions = {},
): Promise<ExportReaderResult> {
  const bytes = await getPdfBytes(document.id);
  if (!bytes) throw new Error('cannot publish: original PDF bytes are missing');
  const annotations = await listAnnotations(document.sha256);

  const viewerBundle = options.viewerBundle ?? (await loadViewerBundle());
  const thirdPartyNotices = options.thirdPartyNotices ?? (await loadThirdPartyNotices());

  return exportReader({
    document,
    annotations,
    publishedTitle: options.publishedTitle ?? document.title,
    pdfBytes: bytes,
    viewerBundle,
    thirdPartyNotices,
  });
}

/** Build the editable project backup ZIP (includes private data + PDF bytes). */
export async function backupProject(document: DocumentMeta): Promise<Uint8Array> {
  const bytes = await getPdfBytes(document.id);
  if (!bytes) throw new Error('cannot back up: original PDF bytes are missing');
  const annotations = await listAnnotations(document.sha256);
  return exportProject({ document, annotations, pdfBytes: bytes });
}

/** Collect a document's annotations (helper for the UI). */
export async function documentAnnotations(document: DocumentMeta): Promise<Annotation[]> {
  return listAnnotations(document.sha256);
}
