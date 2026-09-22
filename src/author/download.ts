/**
 * Trigger a browser download of raw bytes as a file.
 *
 * Uses an object URL + a synthetic anchor click, which works with external
 * domains blocked (the blob is local). The URL is revoked after the click to
 * release the buffer.
 */
export function downloadBytes(
  doc: Document,
  bytes: Uint8Array,
  filename: string,
  mimeType = 'application/octet-stream',
): void {
  const blob = new Blob([bytes], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = doc.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  doc.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick so the click has a chance to start the download.
  const w = doc.defaultView;
  (w?.setTimeout ?? setTimeout)(() => URL.revokeObjectURL(url), 0);
}
