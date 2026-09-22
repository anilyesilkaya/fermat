import { AuthorApp } from './app';

/**
 * Authoring-app entry point (referenced by the root index.html).
 *
 * This is the ONLY entry that pulls in IndexedDB, PDF import, and ZIP export —
 * the read-only viewer is a separate build and never imports this graph.
 */
async function bootstrap(): Promise<void> {
  const mount = document.getElementById('app');
  if (!mount) throw new Error('missing #app mount element');
  const app = new AuthorApp(mount);
  await app.init();
}

void bootstrap().catch((err) => {
  // Surface a fatal init error visibly rather than only in the console.
  const mount = document.getElementById('app');
  if (mount) {
    const box = document.createElement('div');
    box.className = 'fa-error-banner';
    box.textContent = `Fermat failed to start: ${err instanceof Error ? err.message : String(err)}`;
    mount.appendChild(box);
  }
});
