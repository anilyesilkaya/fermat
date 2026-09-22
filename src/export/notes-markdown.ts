import type { PublicAnnotation, PublicManifest } from '../model/projection';
import { pageLabel, serializeDeepLink } from '../notes/navigation';

/**
 * Build the `notes.md` fallback from the SAME public projection the reader uses,
 * so it can never contain a note that the interactive reader omits (or vice
 * versa). Each note carries the source title, a human (1-based) page label, its
 * annotation id, and a relative deep link into the reader.
 *
 * Output is deterministic given deterministic input (the projection is already
 * sorted), preserving Unicode and math source (`$…$`) verbatim.
 */
export function buildNotesMarkdown(
  manifest: PublicManifest,
  annotations: readonly PublicAnnotation[],
  readerHref = './index.html',
): string {
  const lines: string[] = [];
  lines.push(`# ${manifest.title}`, '');
  lines.push(
    `> Notes exported from Fermat. Open the interactive reader: [${readerHref}](${readerHref})`,
    '',
  );

  let currentPage = -1;
  for (const ann of annotations) {
    const page = ann.anchor.pageIndex;
    if (page !== currentPage) {
      currentPage = page;
      lines.push('', `## Page ${pageLabel(page)}`, '');
    }
    const link = `${readerHref}${serializeDeepLink({ pageIndex: page, noteId: ann.id })}`;
    lines.push(`- **[Note ${ann.id}](${link})**`);
    // Indent the body so multi-line notes stay within the list item.
    for (const bodyLine of ann.bodyMarkdown.split('\n')) {
      lines.push(`  ${bodyLine}`);
    }
    lines.push('');
  }

  // Single trailing newline, no timestamp — deterministic.
  return lines.join('\n').replace(/\n+$/, '\n');
}
