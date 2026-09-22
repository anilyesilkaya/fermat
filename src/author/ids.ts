/**
 * Impure seams — the two nondeterministic inputs the authoring logic needs.
 *
 * Kept isolated so every builder that consumes them stays pure and testable:
 * tests inject fixed values, production calls these. Nothing else in the author
 * layer should read the clock or generate ids directly.
 */

/** A fresh RFC-4122 v4 UUID (lowercased), via Web Crypto / Node crypto. */
export function newUuid(): string {
  return crypto.randomUUID().toLowerCase();
}

/** Current instant as an ISO-8601 UTC timestamp (matches the IsoDateTime schema). */
export function nowIso(): string {
  return new Date().toISOString();
}
