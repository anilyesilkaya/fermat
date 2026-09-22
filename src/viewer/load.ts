import { z } from 'zod';
import { Anchor, Sha256 } from '../model/schema';

/**
 * Viewer-side loading + validation of the published data files.
 *
 * The reader is a static bundle: it fetches manifest.json, annotations.json, and
 * document.pdf with RELATIVE URLs resolved against this module's location, so it
 * works at any nested subdirectory with no server rewrites and never calls a
 * remote origin. The JSON is validated with a minimal schema (the viewer trusts
 * only the allowlisted public shape, not the full authoring model).
 */

const PublicManifestSchema = z.object({
  schemaVersion: z.number().int(),
  viewerSchemaVersion: z.number().int(),
  title: z.string(),
  source: z.object({
    sha256: Sha256,
    pageCount: z.number().int().positive(),
    sourceRevision: z.number().int().positive(),
  }),
});

const PublicAnnotationSchema = z.object({
  schemaVersion: z.number().int(),
  id: z.string(),
  documentSha256: Sha256,
  anchor: Anchor,
  bodyMarkdown: z.string(),
  color: z.string(),
  tags: z.array(z.string()),
});

export type LoadedManifest = z.infer<typeof PublicManifestSchema>;
export type LoadedAnnotation = z.infer<typeof PublicAnnotationSchema>;

export interface LoadedReading {
  manifest: LoadedManifest;
  annotations: LoadedAnnotation[];
  /** Resolved URL for the PDF (relative to the bundle). */
  pdfUrl: string;
}

/** Resolve a bundle-relative path against the reader's own location. */
function resolveBundleUrl(path: string, base: string): string {
  return new URL(path, base).href;
}

/**
 * Fetch + validate the reading. `baseUrl` should be the directory of the
 * reader's index.html (e.g. `new URL('.', import.meta.url).href` or
 * `document.baseURI`). PDF bytes are NOT fetched here — only the small JSON —
 * so displaying the reader shell does not download the PDF eagerly.
 */
export async function loadReading(baseUrl: string): Promise<LoadedReading> {
  const manifestUrl = resolveBundleUrl('manifest.json', baseUrl);
  const annotationsUrl = resolveBundleUrl('annotations.json', baseUrl);

  const [manifestRes, annotationsRes] = await Promise.all([
    fetch(manifestUrl),
    fetch(annotationsUrl),
  ]);
  if (!manifestRes.ok) throw new Error(`failed to load manifest.json (${manifestRes.status})`);
  if (!annotationsRes.ok) throw new Error(`failed to load annotations.json (${annotationsRes.status})`);

  const manifest = PublicManifestSchema.parse(await manifestRes.json());
  const annotationsRaw = await annotationsRes.json();
  const annotations = z.array(PublicAnnotationSchema).parse(annotationsRaw);

  // Cross-check: every annotation must belong to this document.
  for (const ann of annotations) {
    if (ann.documentSha256 !== manifest.source.sha256) {
      throw new Error(`annotation ${ann.id} does not match the published document digest`);
    }
  }

  return {
    manifest,
    annotations,
    pdfUrl: resolveBundleUrl('document.pdf', baseUrl),
  };
}
