import { z } from 'zod';

/**
 * Canonical, versioned data model for Fermat.
 *
 * Design rules encoded here:
 *   - Original PDF bytes are immutable; identity is a project/document id plus a
 *     full SHA-256 digest of those bytes. A filename or title is never identity.
 *   - Anchors are stored in canonical PDF user space (see coordinateSpace). The
 *     renderer maps them to the viewport; the stored geometry never depends on
 *     zoom, CSS scale, or device pixel ratio.
 *   - Text selections keep one quad per line (multiline selections are NOT a
 *     single bounding rectangle).
 *   - Publication defaults to private. Only explicitly published annotations are
 *     projected into an exported reader (see projection.ts).
 *
 * Bump SCHEMA_VERSION and add a migration (migrate.ts) for any breaking change.
 */
export const SCHEMA_VERSION = 1 as const;

/**
 * Number guards built with self-contained refinements (no method chaining after
 * `.refine`, which would drop the `ZodNumber` type and break at runtime). Each
 * rejects NaN and ±Infinity because `Number.isFinite` is false for both.
 */
const finite = () => z.number().refine(Number.isFinite, 'must be a finite number');
const finitePositive = () =>
  z.number().refine((v) => Number.isFinite(v) && v > 0, 'must be a positive finite number');
const fraction01 = () =>
  z
    .number()
    .refine((v) => Number.isFinite(v) && v >= 0 && v <= 1, 'must be a finite number in [0, 1]');

/** Lowercase 64-hex-character SHA-256 digest. */
export const Sha256 = z
  .string()
  .regex(/^[0-9a-f]{64}$/, 'must be 64 lowercase hex characters (SHA-256)');

/** RFC 4122 UUID (any version), lowercase-normalized on validation. */
export const Uuid = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    'must be a UUID',
  );

/** ISO-8601 timestamp with a timezone. Regex avoids zod-version-specific APIs. */
export const IsoDateTime = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/,
    'must be an ISO-8601 date-time with timezone',
  );

/** `#rrggbb` hex color. */
export const HexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'must be a #rrggbb hex color');

/** A single 2D vertex `[x, y]` in PDF user space. */
export const Vertex = z.tuple([finite(), finite()]);

/**
 * A quadrilateral: exactly four vertices in a documented order —
 * [top-left, top-right, bottom-right, bottom-left] in the page's reading
 * orientation (before viewport rotation is applied).
 */
export const Quad = z.tuple([Vertex, Vertex, Vertex, Vertex]);

/** PDF view box (CropBox) as `[x0, y0, x1, y1]`, matching PDF.js `page.view`. */
export const ViewBox = z.tuple([finite(), finite(), finite(), finite()]);

/** Inherent page rotation is always a quarter turn. */
export const Rotation = z.union([
  z.literal(0),
  z.literal(90),
  z.literal(180),
  z.literal(270),
]);

/**
 * Optional text-quote context. W3C-inspired (prefix/exact/suffix); it does NOT
 * claim to validate against the W3C Annotation spec. `normalizationVersion`
 * records exactly how the strings were normalized so a future recovery pass can
 * compare like with like.
 */
export const TextContext = z.object({
  exact: z.string().max(20_000),
  prefix: z.string().max(2_000),
  suffix: z.string().max(2_000),
  normalizationVersion: z.number().int().positive(),
});

/** Fields shared by every anchor: which page and the page's canonical frame. */
const PageFrame = z.object({
  pageIndex: z.number().int().nonnegative(),
  pageViewBox: ViewBox,
  pageRotation: Rotation,
  userUnit: finitePositive().default(1),
  coordinateSpace: z.literal('pdf-user-space'),
});

/** Highlight over selectable text: one quad per line. */
export const TextAnchor = PageFrame.extend({
  kind: z.literal('text'),
  quads: z.array(Quad).min(1),
  quote: TextContext.optional(),
});

/** Rectangular region (e.g. a figure or a scanned page without text). */
export const RegionAnchor = PageFrame.extend({
  kind: z.literal('region'),
  quad: Quad,
});

/** A single point marker. */
export const PointAnchor = PageFrame.extend({
  kind: z.literal('point'),
  point: Vertex,
});

export const Anchor = z.discriminatedUnion('kind', [
  TextAnchor,
  RegionAnchor,
  PointAnchor,
]);

export const Publication = z.enum(['private', 'public']);

/**
 * A single annotation. `documentSha256` binds it to exact PDF bytes; the note is
 * never silently migrated to a different PDF.
 */
export const Annotation = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: Uuid,
  documentSha256: Sha256,
  anchor: Anchor,
  bodyMarkdown: z.string().max(50_000),
  color: HexColor.default('#ffe066'),
  tags: z.array(z.string().max(100)).max(200).default([]),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  publication: Publication.default('private'),
  revision: z.number().int().positive().default(1),
});

export const ReadingStatus = z.enum(['unread', 'reading', 'finished']);

/** Bibliographic + identity metadata for one imported PDF. */
export const DocumentMeta = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: Uuid,
  sha256: Sha256,
  title: z.string().max(1_000),
  originalFilename: z.string().max(1_000),
  byteSize: z.number().int().nonnegative(),
  pageCount: z.number().int().positive(),
  sourceRevision: z.number().int().positive().default(1),
  tags: z.array(z.string().max(100)).max(200).default([]),
  readingStatus: ReadingStatus.default('unread'),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

/**
 * Where the reader left off. Deliberately separate from published annotations so
 * a reader's position is never confused with the author's publication.
 */
export const ReaderState = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  documentId: Uuid,
  documentSha256: Sha256,
  pageIndex: z.number().int().nonnegative(),
  scrollFraction: fraction01().optional(),
  zoom: finitePositive().optional(),
  updatedAt: IsoDateTime,
});

/**
 * The editable-project envelope written into a backup ZIP alongside the original
 * PDF bytes. May contain private information.
 */
export const ProjectFile = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  document: DocumentMeta,
  annotations: z.array(Annotation),
  readerState: ReaderState.optional(),
});

// ---------------------------------------------------------------------------
// Inferred TypeScript types (single source of truth is the schema above).
// ---------------------------------------------------------------------------
export type Vertex = z.infer<typeof Vertex>;
export type Quad = z.infer<typeof Quad>;
export type ViewBox = z.infer<typeof ViewBox>;
export type Rotation = z.infer<typeof Rotation>;
export type TextContext = z.infer<typeof TextContext>;
export type TextAnchor = z.infer<typeof TextAnchor>;
export type RegionAnchor = z.infer<typeof RegionAnchor>;
export type PointAnchor = z.infer<typeof PointAnchor>;
export type Anchor = z.infer<typeof Anchor>;
export type Publication = z.infer<typeof Publication>;
export type Annotation = z.infer<typeof Annotation>;
export type ReadingStatus = z.infer<typeof ReadingStatus>;
export type DocumentMeta = z.infer<typeof DocumentMeta>;
export type ReaderState = z.infer<typeof ReaderState>;
export type ProjectFile = z.infer<typeof ProjectFile>;
