/**
 * Tiny click-to-open launcher for embedding a published reader inside an
 * existing static page.
 *
 * Contract:
 *   - Nothing is fetched until the user clicks: the <iframe> (and therefore the
 *     reader's document.pdf) is created ONLY in the click handler. `loading="lazy"`
 *     is not a click gate, so we do not rely on it.
 *   - The plain <a> link is always present as a fallback (works with JS off and
 *     for right-click/open-in-new-tab).
 *   - Multiple launchers coexist on one page: no global IDs, no shared mutable
 *     state, each instance closes over its own elements.
 *   - No dependency on the host page exposing any framework or global.
 *
 * Distributed as a tiny standalone script; see embed/index.ts for the auto-init
 * that scans for `[data-fermat-embed]` anchors.
 */

export interface LauncherOptions {
  /** Relative URL to the reader's index.html. */
  readerUrl: string;
  /** Accessible title for the iframe. */
  title?: string;
  /** iframe height CSS value (default "80vh"). */
  height?: string;
  /** Button label before opening (default "Open annotated reading"). */
  buttonLabel?: string;
}

/**
 * Wire a container so a button reveals the reader in an iframe on first click.
 * The container should already contain a fallback <a>; if not, one is added.
 * Returns a disposer that removes listeners.
 */
export function mountLauncher(container: HTMLElement, options: LauncherOptions): () => void {
  const doc = container.ownerDocument;
  const title = options.title ?? 'Annotated reading';
  const height = options.height ?? '80vh';

  const button = doc.createElement('button');
  button.type = 'button';
  button.textContent = options.buttonLabel ?? 'Open annotated reading';
  button.className = 'fermat-embed-button';

  // Ensure a fallback link exists (opens the reader directly).
  let fallback = container.querySelector<HTMLAnchorElement>('a[data-fermat-fallback]');
  if (!fallback) {
    fallback = doc.createElement('a');
    fallback.setAttribute('data-fermat-fallback', '');
    fallback.href = options.readerUrl;
    fallback.textContent = 'Open annotated reading';
    container.appendChild(fallback);
  }

  let opened = false;
  const onClick = (): void => {
    if (opened) return;
    opened = true;
    // Create the iframe ONLY now — this is the first network request for the
    // reader and its PDF.
    const iframe = doc.createElement('iframe');
    iframe.src = options.readerUrl;
    iframe.title = title;
    iframe.loading = 'lazy';
    iframe.style.width = '100%';
    iframe.style.height = height;
    iframe.style.border = '0';
    button.replaceWith(iframe);
  };

  button.addEventListener('click', onClick);
  container.insertBefore(button, fallback);

  return () => {
    button.removeEventListener('click', onClick);
    button.remove();
  };
}
