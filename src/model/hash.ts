/**
 * SHA-256 of raw PDF bytes — the canonical document identity.
 *
 * Uses the Web Crypto API (`crypto.subtle`), available in browsers and in Node
 * ≥ the versions this project targets. The digest is lowercase hex, matching the
 * `Sha256` schema. Never derive identity from a filename or title.
 */
export async function sha256Hex(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  // Copy into a fresh ArrayBuffer so a Uint8Array view over a larger/shared
  // buffer (or a SharedArrayBuffer) is hashed over exactly its own range.
  const buf = view.byteOffset === 0 && view.byteLength === view.buffer.byteLength && view.buffer instanceof ArrayBuffer
    ? view.buffer
    : view.slice().buffer;
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return bytesToHex(new Uint8Array(digest));
}

function bytesToHex(bytes: Uint8Array): string {
  const hex = new Array<string>(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    // `!` is safe: i is always in range.
    hex[i] = bytes[i]!.toString(16).padStart(2, '0');
  }
  return hex.join('');
}
