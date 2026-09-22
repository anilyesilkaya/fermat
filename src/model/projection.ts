import type {
  Annotation,
  Anchor,
  DocumentMeta,
  TextContext,
} from './schema';
import { SCHEMA_VERSION } from './schema';

/**
 * Public projection — the ONLY path from the authoring model to anything an
 * exported reader can see.
 *
 * Safety contract:
 *   - Allowlist, not blocklist. Every field in the output is constructed
 *     explicitly below. We never spread (`...ann`) a source object, so a field
 *     added to the authoring model later cannot silently leak into a publication.
 *   - Only `publication === 'public'` annotations are included.
 *   - Reader state, private drafts, local filesystem paths, unrelated document
 *     metadata, and authoring caches have no field here and cannot appear.
 *   - Output is sorted deterministically so re-exporting unchanged data yields a
 *     byte-identical file (no timestamp churn).
 *
 * `manifest.json`, `annotations.json`, the search index, and the `notes.md`
 * fallback are all built from the SAME filtered data (see export module), so a
 * private note cannot appear in one artifact while being filtered from another.
 */

export const VIEWER_SCHEMA_VERSION = SCHEMA_VERSION;

/** Published shape of a text-quote context (kept verbatim; it is public text). */
export interface PublicTextContext {
  exact: string;
  prefix: string;
  suffix: string;
  normalizationVersion: number;
}

export interface PublicAnnotation {
  schemaVersion: number;
  id: string;
  documentSha256: string;
  anchor: Anchor;
  bodyMarkdown: string;
  color: string;
  tags: string[];
}

export interface PublicManifest {
  schemaVersion: number;
  viewerSchemaVersion: number;
  title: string;
  source: {
    sha256: string;
    pageCount: number;
    sourceRevision: number;
  };
}

export interface PublicProjection {
  manifest: PublicManifest;
  annotations: PublicAnnotation[];
}

/** Rebuild an anchor with only the geometry/context fields the viewer needs. */
function projectAnchor(anchor: Anchor): Anchor {
  const base = {
    pageIndex: anchor.pageIndex,
    pageViewBox: anchor.pageViewBox,
    pageRotation: anchor.pageRotation,
    userUnit: anchor.userUnit,
    coordinateSpace: 'pdf-user-space' as const,
  };
  switch (anchor.kind) {
    case 'text':
      return {
        kind: 'text',
        ...base,
        quads: anchor.quads,
        ...(anchor.quote ? { quote: projectQuote(anchor.quote) } : {}),
      };
    case 'region':
      return { kind: 'region', ...base, quad: anchor.quad };
    case 'point':
      return { kind: 'point', ...base, point: anchor.point };
  }
}

function projectQuote(quote: TextContext): PublicTextContext {
  return {
    exact: quote.exact,
    prefix: quote.prefix,
    suffix: quote.suffix,
    normalizationVersion: quote.normalizationVersion,
  };
}

function projectAnnotation(ann: Annotation): PublicAnnotation {
  return {
    schemaVersion: VIEWER_SCHEMA_VERSION,
    id: ann.id,
    documentSha256: ann.documentSha256,
    anchor: projectAnchor(ann.anchor),
    bodyMarkdown: ann.bodyMarkdown,
    color: ann.color,
    // Copy tag values individually; never share the source array reference.
    tags: [...ann.tags],
  };
}

/** Deterministic order: page, then reading position, then id as a stable tiebreak. */
function comparePublic(a: PublicAnnotation, b: PublicAnnotation): number {
  const ap = a.anchor.pageIndex;
  const bp = b.anchor.pageIndex;
  if (ap !== bp) return ap - bp;
  const ay = topYOf(a.anchor);
  const by = topYOf(b.anchor);
  // Higher y is nearer the top of a PDF page (origin bottom-left); sort top-down.
  if (ay !== by) return by - ay;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function topYOf(anchor: Anchor): number {
  switch (anchor.kind) {
    case 'text': {
      let maxY = -Infinity;
      for (const quad of anchor.quads) {
        for (const [, y] of quad) if (y > maxY) maxY = y;
      }
      return maxY;
    }
    case 'region': {
      let maxY = -Infinity;
      for (const [, y] of anchor.quad) if (y > maxY) maxY = y;
      return maxY;
    }
    case 'point':
      return anchor.point[1];
  }
}

/**
 * Build the complete public projection from the private model.
 *
 * @param doc          authoring document metadata (only allowlisted fields used)
 * @param annotations  ALL annotations for the document; private ones are dropped
 * @param publishedTitle  the title the author approved for publication
 */
export function projectPublic(
  doc: DocumentMeta,
  annotations: readonly Annotation[],
  publishedTitle: string,
): PublicProjection {
  const publicAnnotations = annotations
    .filter((a) => a.publication === 'public')
    .map(projectAnnotation)
    .sort(comparePublic);

  const manifest: PublicManifest = {
    schemaVersion: SCHEMA_VERSION,
    viewerSchemaVersion: VIEWER_SCHEMA_VERSION,
    title: publishedTitle,
    source: {
      sha256: doc.sha256,
      pageCount: doc.pageCount,
      sourceRevision: doc.sourceRevision,
    },
  };

  return { manifest, annotations: publicAnnotations };
}
