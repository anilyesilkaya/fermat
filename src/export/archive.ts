import { zipSync, unzipSync, strToU8, strFromU8, type Zippable } from 'fflate';
import { safeEntryPath, SizeGuard, type SizeBudget } from './zip-safety';

/**
 * Thin, deterministic ZIP layer over fflate.
 *
 * - `buildZip` writes entries in sorted key order with a fixed modification
 *   time, so re-exporting identical content yields byte-identical archives (no
 *   timestamp churn) — required by the deterministic-output contract.
 * - `readZipSafe` validates every entry name (path traversal) and enforces a
 *   decompression budget before returning the entries.
 */

/** A fixed epoch for deterministic archives (2020-01-01T00:00:00Z, DOS-safe). */
const FIXED_MTIME = new Date('2020-01-01T00:00:00Z');

export type ZipEntries = Record<string, Uint8Array>;

/** Build a deterministic ZIP from a name→bytes map. */
export function buildZip(entries: ZipEntries): Uint8Array {
  const sortedNames = Object.keys(entries).sort();
  const zippable: Zippable = {};
  for (const name of sortedNames) {
    // Per-file options: level 6, fixed mtime for reproducibility.
    zippable[name] = [entries[name]!, { level: 6, mtime: FIXED_MTIME }];
  }
  return zipSync(zippable, { level: 6, mtime: FIXED_MTIME });
}

/** Convenience: a UTF-8 text entry. */
export function textEntry(text: string): Uint8Array {
  return strToU8(text);
}

/** Convenience: decode a UTF-8 text entry. */
export function entryToText(bytes: Uint8Array): string {
  return strFromU8(bytes);
}

export interface ReadZipOptions {
  budget?: SizeBudget;
}

/**
 * Unzip and validate. Returns a map keyed by SAFE, normalized relative paths.
 * Throws `UnsafeZipEntryError` / `ZipSizeLimitError` on malicious input.
 */
export function readZipSafe(archive: Uint8Array, options: ReadZipOptions = {}): ZipEntries {
  const raw = unzipSync(archive);
  const guard = new SizeGuard(options.budget);
  const out: ZipEntries = {};
  // Deterministic processing order.
  for (const name of Object.keys(raw).sort()) {
    const bytes = raw[name]!;
    // Skip directory entries (trailing slash, zero bytes).
    if (name.endsWith('/') && bytes.length === 0) continue;
    const safe = safeEntryPath(name);
    guard.add(safe, bytes.length);
    out[safe] = bytes;
  }
  return out;
}
