import { mountLauncher } from './launcher';

export { mountLauncher } from './launcher';
export type { LauncherOptions } from './launcher';

/**
 * Auto-initialize any `[data-fermat-embed]` anchors on the page into
 * click-to-open launchers. The anchor's href is the reader URL and doubles as
 * the no-JS fallback.
 *
 *   <span data-fermat-embed>
 *     <a href="./readings/paper/index.html" data-fermat-fallback>Open reading</a>
 *   </span>
 *
 * Safe to include on pages with several readings — each anchor becomes its own
 * independent launcher with no shared state.
 */
export function initFermatEmbeds(root: ParentNode = document): void {
  const containers = root.querySelectorAll<HTMLElement>('[data-fermat-embed]');
  containers.forEach((container) => {
    const link = container.querySelector<HTMLAnchorElement>('a[href]');
    const readerUrl = container.dataset.fermatEmbed || link?.getAttribute('href');
    if (!readerUrl) return;
    mountLauncher(container, {
      readerUrl,
      ...(container.dataset.fermatTitle ? { title: container.dataset.fermatTitle } : {}),
      ...(container.dataset.fermatHeight ? { height: container.dataset.fermatHeight } : {}),
    });
  });
}

// Auto-run when loaded as a plain script in a browser.
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => initFermatEmbeds());
  } else {
    initFermatEmbeds();
  }
}
