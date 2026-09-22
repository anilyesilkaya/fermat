/**
 * Deep-link fragment parsing/serialization for the reader.
 *
 * Contract from the brief: stable fragments like `#page=4&note=<uuid>`, where
 * the page number shown to the reader is 1-BASED (page 4) while the internal
 * page index is 0-BASED (index 3). This module is the single place that
 * translates between the two, so no other code does off-by-one math.
 *
 * Pure string logic — no DOM — so it is trivially testable and shared by author
 * and viewer.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface DeepLink {
  /** Zero-based page index (internal). */
  pageIndex?: number;
  /** Annotation UUID to focus, if any. */
  noteId?: string;
}

/** Parse a location hash (`#page=4&note=…` or `page=4&note=…`) into a DeepLink. */
export function parseDeepLink(hash: string): DeepLink {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  const params = new URLSearchParams(raw);
  const result: DeepLink = {};

  const pageStr = params.get('page');
  if (pageStr !== null) {
    const oneBased = Number(pageStr);
    if (Number.isInteger(oneBased) && oneBased >= 1) {
      result.pageIndex = oneBased - 1; // 1-based (shown) → 0-based (internal)
    }
  }

  const note = params.get('note');
  if (note !== null && UUID_RE.test(note)) {
    result.noteId = note.toLowerCase();
  }

  return result;
}

/** Serialize a DeepLink to a fragment string beginning with `#`. */
export function serializeDeepLink(link: DeepLink): string {
  const params = new URLSearchParams();
  if (link.pageIndex !== undefined && Number.isInteger(link.pageIndex) && link.pageIndex >= 0) {
    params.set('page', String(link.pageIndex + 1)); // 0-based → 1-based (shown)
  }
  if (link.noteId !== undefined && UUID_RE.test(link.noteId)) {
    params.set('note', link.noteId);
  }
  const s = params.toString();
  return s ? `#${s}` : '';
}

/** Human page label (1-based) from a zero-based index. */
export function pageLabel(pageIndex: number): number {
  return pageIndex + 1;
}
