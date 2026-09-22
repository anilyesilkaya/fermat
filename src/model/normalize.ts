/**
 * Text normalization for text-quote context.
 *
 * The `normalizationVersion` stored on every TextContext refers to exactly this
 * function's behavior. If normalization ever changes, bump NORMALIZATION_VERSION
 * and keep the old behavior addressable so stored quotes compare like-with-like.
 *
 * Unicode note: we operate on code points via the string's iterator, NOT on
 * UTF-16 code units, and we apply NFC so canonically-equivalent text matches.
 * We do not compute character offsets here; if offsets are added later they must
 * specify code-point semantics explicitly rather than mixing with UTF-16.
 */
export const NORMALIZATION_VERSION = 1 as const;

/**
 * Collapse runs of Unicode whitespace to a single space, trim ends, and apply
 * NFC. Used to compare a stored quote against freshly extracted PDF text without
 * being defeated by incidental whitespace or composition differences.
 */
export function normalizeQuoteText(input: string): string {
  const nfc = input.normalize('NFC');
  // \s in JS regex with the u flag covers ASCII + common Unicode whitespace.
  return nfc.replace(/\s+/gu, ' ').trim();
}

/** Count Unicode code points (not UTF-16 code units). */
export function codePointLength(input: string): number {
  let n = 0;
  for (const _cp of input) n++;
  return n;
}
