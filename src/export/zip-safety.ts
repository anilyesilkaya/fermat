/**
 * ZIP path + size safety, applied to EVERY entry read from an imported archive.
 *
 * A project ZIP is untrusted input. Two classic attacks are rejected here:
 *   - Path traversal / absolute paths ("zip slip"): an entry named `../../x` or
 *     `C:\x` or `/etc/x` that would escape the extraction root. We never touch
 *     the real filesystem, but the same names could poison an in-memory map or a
 *     later write, so we reject them at the boundary.
 *   - Decompression bombs: a small archive that expands enormously. Callers pass
 *     a per-entry and total budget; exceeding either aborts the import.
 *
 * These are pure predicates so they are easy to unit-test.
 */

export class UnsafeZipEntryError extends Error {
  constructor(
    readonly entryName: string,
    reason: string,
  ) {
    super(`unsafe ZIP entry ${JSON.stringify(entryName)}: ${reason}`);
    this.name = 'UnsafeZipEntryError';
  }
}

export class ZipSizeLimitError extends Error {
  constructor(reason: string) {
    super(`ZIP decompression limit exceeded: ${reason}`);
    this.name = 'ZipSizeLimitError';
  }
}

/**
 * Normalize and validate an entry name to a safe, forward-slash relative path.
 * Throws `UnsafeZipEntryError` on anything that could escape the root.
 */
export function safeEntryPath(name: string): string {
  if (name.length === 0) throw new UnsafeZipEntryError(name, 'empty name');

  // Reject NUL and control characters.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f]/.test(name)) {
    throw new UnsafeZipEntryError(name, 'contains control characters');
  }

  // Normalize backslashes to forward slashes (Windows-authored archives).
  const unified = name.replace(/\\/g, '/');

  // Absolute (POSIX) paths.
  if (unified.startsWith('/')) {
    throw new UnsafeZipEntryError(name, 'absolute path');
  }
  // Windows drive-letter absolute paths (e.g. C:/...).
  if (/^[a-zA-Z]:\//.test(unified)) {
    throw new UnsafeZipEntryError(name, 'drive-letter absolute path');
  }

  const segments = unified.split('/');
  for (const seg of segments) {
    if (seg === '..') {
      throw new UnsafeZipEntryError(name, 'parent-directory traversal (..)');
    }
  }

  // Collapse `.` and empty segments (from `//` or trailing slash).
  const clean = segments.filter((s) => s !== '' && s !== '.').join('/');
  if (clean.length === 0) {
    throw new UnsafeZipEntryError(name, 'resolves to an empty path');
  }
  return clean;
}

export interface SizeBudget {
  /** Max decompressed bytes for any single entry. */
  maxEntryBytes: number;
  /** Max decompressed bytes across all entries. */
  maxTotalBytes: number;
}

/** Sensible defaults for a project import (256 MB/entry, 1 GiB total). */
export const DEFAULT_SIZE_BUDGET: SizeBudget = {
  maxEntryBytes: 256 * 1024 * 1024,
  maxTotalBytes: 1024 * 1024 * 1024,
};

/** Accumulates decompressed sizes and throws when a budget is exceeded. */
export class SizeGuard {
  private total = 0;
  constructor(private readonly budget: SizeBudget = DEFAULT_SIZE_BUDGET) {}

  /** Record one entry's decompressed byte length; throws if over budget. */
  add(entryName: string, byteLength: number): void {
    if (byteLength > this.budget.maxEntryBytes) {
      throw new ZipSizeLimitError(
        `entry ${JSON.stringify(entryName)} is ${byteLength} bytes (max ${this.budget.maxEntryBytes})`,
      );
    }
    this.total += byteLength;
    if (this.total > this.budget.maxTotalBytes) {
      throw new ZipSizeLimitError(
        `total ${this.total} bytes exceeds max ${this.budget.maxTotalBytes}`,
      );
    }
  }
}
