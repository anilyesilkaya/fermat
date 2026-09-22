import type { Annotation } from '../model/schema';

/**
 * Publication preflight.
 *
 * Two distinct things can be "annotations" on a page:
 *   - Fermat notes (ours) — margin notes the author wrote in this app.
 *   - Embedded PDF comment annotations — markup already inside the source PDF
 *     bytes (e.g. sticky notes, highlights added by another tool).
 *
 * Selecting/deselecting a Fermat note only controls what Fermat publishes; it
 * does NOT edit the PDF bytes. So if the source PDF itself carries embedded
 * comments, those bytes ship as-is inside the reader's document.pdf. Preflight
 * surfaces that fact and requires the author to explicitly confirm the source
 * PDF's inclusion before a publication export.
 *
 * We deliberately do NOT claim to sanitize, redact, or remove hidden data from
 * the PDF. Preflight informs; it does not launder the source.
 */

export interface PreflightInput {
  annotations: readonly Annotation[];
  /**
   * Count of supported embedded comment annotations detected in the source PDF
   * by the PDF adapter (see src/pdf). 0 if none/undetectable.
   */
  embeddedCommentCount: number;
}

export interface PreflightReport {
  publicNoteCount: number;
  privateNoteCount: number;
  /** True if any public notes exist to publish. */
  hasPublishable: boolean;
  /** True if the source PDF carries embedded comments needing author review. */
  embeddedCommentsPresent: boolean;
  embeddedCommentCount: number;
  /** Human-readable warnings the UI must show before allowing export. */
  warnings: string[];
  /** Author must acknowledge these before the publication export proceeds. */
  requiresAcknowledgement: boolean;
}

export function preflightPublication(input: PreflightInput): PreflightReport {
  const publicNotes = input.annotations.filter((a) => a.publication === 'public');
  const privateNotes = input.annotations.filter((a) => a.publication === 'private');

  const warnings: string[] = [];
  const embeddedCommentsPresent = input.embeddedCommentCount > 0;

  if (embeddedCommentsPresent) {
    warnings.push(
      `The source PDF contains ${input.embeddedCommentCount} embedded comment ` +
        `annotation(s). These are part of the PDF file and will be included in the ` +
        `published document.pdf as-is. Fermat does not remove or redact them. ` +
        `Review the original PDF before publishing.`,
    );
  }
  if (publicNotes.length === 0) {
    warnings.push('No notes are marked public; the reader would contain no Fermat notes.');
  }

  return {
    publicNoteCount: publicNotes.length,
    privateNoteCount: privateNotes.length,
    hasPublishable: publicNotes.length > 0,
    embeddedCommentsPresent,
    embeddedCommentCount: input.embeddedCommentCount,
    warnings,
    requiresAcknowledgement: embeddedCommentsPresent,
  };
}
