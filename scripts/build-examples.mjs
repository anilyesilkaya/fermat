/**
 * Build the demo bookshelf: a landing index.html listing PDF titles, where
 * clicking a title opens its own self-contained annotated reader in the browser.
 *
 * Each reader under examples/readers/<slug>/ is a relocatable static directory —
 * a copy of the built viewer bundle (public/viewer/) plus the three data files a
 * published reading needs, in the exact PUBLIC shape the viewer validates:
 *   index.html, assets/…      the viewer runtime (verbatim from the build)
 *   document.pdf              the drawn source PDF
 *   manifest.json             public manifest  { title, source:{sha256,…} }
 *   annotations.json          public annotations (anchors in PDF user space)
 *   THIRD_PARTY_NOTICES.txt   bundled-software notices
 *
 * All links are RELATIVE, so the whole examples/ tree deploys to GitHub Pages
 * (or any static host) at any base path with no rewrites — the same contract the
 * e2e test proves. No network, no build-time TypeScript: the geometry comes from
 * examples/geometry.json (emitted by scripts/gen-example-pdfs.py).
 *
 * Prerequisite: `npm run build:viewer && npm run prepare:viewer` (populates
 * public/viewer/). Run: `node scripts/build-examples.mjs`.
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const VIEWER_DIR = join(ROOT, 'public', 'viewer');
const EXAMPLES = join(ROOT, 'examples');
const READERS = join(EXAMPLES, 'readers');
const PDF_DIR = join(EXAMPLES, 'pdfs');

const SCHEMA_VERSION = 1; // must match src/model/schema.ts SCHEMA_VERSION.

function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/** One text-line quad from a PDF-user-space box [x0,y0,x1,y1].
 *  Vertex order [top-left, top-right, bottom-right, bottom-left] (y up). */
function boxToQuad([x0, y0, x1, y1]) {
  return [
    [x0, y1],
    [x1, y1],
    [x1, y0],
    [x0, y0],
  ];
}

function pageFrame(pageIndex, pageSize) {
  return {
    pageIndex,
    pageViewBox: [0, 0, pageSize[0], pageSize[1]],
    pageRotation: 0,
    userUnit: 1,
    coordinateSpace: 'pdf-user-space',
  };
}

/** Build a PublicAnnotation matching src/viewer/load.ts's schema exactly. */
function buildAnnotation(note, sha256, pageSize, geomLines) {
  const frame = pageFrame(note.page, pageSize);
  let anchor;
  if (note.kind === 'text') {
    const g = geomLines[note.line];
    if (!g) throw new Error(`no geometry for line id "${note.line}"`);
    if (g.page !== note.page) {
      throw new Error(`note ${note.id} says page ${note.page} but line "${note.line}" is on page ${g.page}`);
    }
    anchor = { kind: 'text', ...frame, quads: [boxToQuad(g.box)] };
  } else if (note.kind === 'region') {
    anchor = { kind: 'region', ...frame, quad: boxToQuad(note.rect) };
  } else if (note.kind === 'point') {
    anchor = { kind: 'point', ...frame, point: note.point };
  } else {
    throw new Error(`unknown note kind: ${note.kind}`);
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    id: note.id,
    documentSha256: sha256,
    anchor,
    bodyMarkdown: note.body,
    color: note.color,
    tags: note.tags ?? [],
  };
}

/** Copy the built viewer bundle into destDir (every file in its manifest). */
function copyViewerBundle(destDir) {
  const viewerManifestPath = join(VIEWER_DIR, 'manifest.json');
  if (!existsSync(viewerManifestPath)) {
    throw new Error(
      'public/viewer/ not found. Run `npm run build:viewer && npm run prepare:viewer` first.',
    );
  }
  const { files } = JSON.parse(readFileSync(viewerManifestPath, 'utf8'));
  for (const rel of files) {
    const src = join(VIEWER_DIR, rel);
    const dest = join(destDir, rel);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(src, dest);
  }
  // Notices live outside the file list; include them for a faithful reader.
  const notices = join(VIEWER_DIR, 'THIRD_PARTY_NOTICES.txt');
  if (existsSync(notices)) copyFileSync(notices, join(destDir, 'THIRD_PARTY_NOTICES.txt'));
}

function esc(s) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function bookshelfHtml(cards) {
  const items = cards
    .map(
      (c) => `      <li class="card">
        <a class="card-link" href="./readers/${esc(c.slug)}/index.html">
          <h2>${esc(c.title)}</h2>
          <p class="byline">${esc(c.byline)}</p>
          <p class="meta">${c.pageCount} page${c.pageCount === 1 ? '' : 's'} · ${c.noteCount} published note${c.noteCount === 1 ? '' : 's'}</p>
          ${c.tags.length ? `<p class="tags">${c.tags.map((t) => `<span>${esc(t)}</span>`).join('')}</p>` : ''}
          <span class="open">Open reading →</span>
        </a>
      </li>`,
    )
    .join('\n');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Fermat — example readings</title>
    <meta name="description" content="A shelf of annotated PDF readings. Pick a title to open a self-contained interactive reader." />
    <style>
      /* Light is the default; the media query themes dark for no-JS visitors.
         An explicit data-theme (set by the toggle) always wins over both. */
      :root { color-scheme: light; --bg:#fafaf8; --fg:#1c1c1c; --muted:#6b6b6b; --card:#fff; --line:#e6e6e0; --accent:#3050c8; }
      @media (prefers-color-scheme: dark) { :root { color-scheme: dark; --bg:#16161a; --fg:#ececec; --muted:#9a9a9a; --card:#20212a; --line:#31323d; --accent:#8aa0ff; } }
      :root[data-theme="light"] { color-scheme: light; --bg:#fafaf8; --fg:#1c1c1c; --muted:#6b6b6b; --card:#fff; --line:#e6e6e0; --accent:#3050c8; }
      :root[data-theme="dark"] { color-scheme: dark; --bg:#16161a; --fg:#ececec; --muted:#9a9a9a; --card:#20212a; --line:#31323d; --accent:#8aa0ff; }
      * { box-sizing: border-box; }
      body { margin:0; font:16px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background:var(--bg); color:var(--fg); }
      header { max-width:960px; margin:0 auto; padding:56px 24px 24px; }
      .topbar { display:flex; justify-content:flex-end; margin:0 0 12px; }
      .theme-btn { appearance:none; border:1px solid var(--line); background:var(--card); color:var(--fg); border-radius:6px; padding:6px 12px; font:inherit; font-size:14px; line-height:1; cursor:pointer; }
      .theme-btn:hover { border-color:var(--accent); }
      .theme-btn:focus-visible { outline:2px solid var(--accent); outline-offset:1px; }
      h1 { margin:0 0 8px; font-size:30px; letter-spacing:-0.01em; }
      header p { margin:0; color:var(--muted); max-width:60ch; }
      main { max-width:960px; margin:0 auto; padding:8px 24px 64px; }
      ul.shelf { list-style:none; margin:0; padding:0; display:grid; gap:20px; grid-template-columns:repeat(auto-fill, minmax(280px, 1fr)); }
      .card { background:var(--card); border:1px solid var(--line); border-radius:12px; overflow:hidden; transition:transform .12s ease, box-shadow .12s ease; }
      .card:hover { transform:translateY(-2px); box-shadow:0 8px 24px rgba(0,0,0,.10); }
      .card-link { display:block; padding:20px; color:inherit; text-decoration:none; height:100%; }
      .card h2 { margin:0 0 4px; font-size:19px; }
      .byline { margin:0 0 12px; color:var(--muted); font-size:13px; }
      .meta { margin:0 0 12px; color:var(--fg); font-size:14px; }
      .tags { margin:0 0 16px; display:flex; flex-wrap:wrap; gap:6px; }
      .tags span { font-size:12px; padding:2px 8px; border-radius:999px; background:color-mix(in srgb, var(--accent) 15%, transparent); color:var(--accent); }
      .open { font-size:14px; font-weight:600; color:var(--accent); }
      footer { max-width:960px; margin:0 auto; padding:0 24px 56px; color:var(--muted); font-size:13px; }
      footer code { background:color-mix(in srgb, var(--fg) 8%, transparent); padding:1px 5px; border-radius:5px; }
    </style>
  </head>
  <body>
    <header>
      <div class="topbar">
        <button type="button" id="theme-btn" class="theme-btn" aria-pressed="false"></button>
      </div>
      <h1>Example readings</h1>
      <p>Each reading below is a self-contained, interactive reader: its own PDF, its published margin notes, and the viewer runtime — all local files. Pick a title to open one.</p>
    </header>
    <main>
      <ul class="shelf">
${items}
      </ul>
    </main>
    <footer>
      Every reader here loads only relative, local assets — no network, no app-domain dependency — so this whole folder deploys to any static host (including GitHub Pages) at any nested path.
    </footer>
    <script>
      // Light/dark toggle mirroring the reader/author chrome: persisted choice
      // wins, else the OS preference, else light. Self-contained — no network.
      (function () {
        var KEY = 'fermat-examples-theme';
        var root = document.documentElement;
        var btn = document.getElementById('theme-btn');
        function stored() {
          try { var v = localStorage.getItem(KEY); return v === 'dark' || v === 'light' ? v : null; }
          catch (e) { return null; } // storage may be unavailable (private mode / file://).
        }
        function initial() {
          var s = stored();
          if (s) return s;
          return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        }
        function apply(theme, persist) {
          root.dataset.theme = theme;
          if (btn) {
            // Label offers the OTHER theme (the action taken on click).
            var toDark = theme === 'light';
            btn.textContent = toDark ? '🌙 Dark' : '☀ Light';
            btn.title = toDark ? 'Switch to dark theme' : 'Switch to light theme';
            btn.setAttribute('aria-pressed', theme === 'dark' ? 'true' : 'false');
          }
          if (persist) {
            try { localStorage.setItem(KEY, theme); } catch (e) { /* ignore — still applies this session. */ }
          }
        }
        apply(initial(), false);
        if (btn) btn.addEventListener('click', function () {
          apply(root.dataset.theme === 'dark' ? 'light' : 'dark', true);
        });
      })();
    </script>
  </body>
</html>
`;
}

function main() {
  const spec = JSON.parse(readFileSync(join(EXAMPLES, 'readings.json'), 'utf8'));
  const geometry = JSON.parse(readFileSync(join(EXAMPLES, 'geometry.json'), 'utf8'));
  const pageSize = spec.pageSize;

  rmSync(READERS, { recursive: true, force: true });
  mkdirSync(READERS, { recursive: true });

  const cards = [];
  for (const reading of spec.readings) {
    const { slug, title } = reading;
    const pdfPath = join(PDF_DIR, `${slug}.pdf`);
    if (!existsSync(pdfPath)) {
      throw new Error(`missing ${pdfPath}; run scripts/gen-example-pdfs.py first`);
    }
    const pdfBytes = readFileSync(pdfPath);
    const sha256 = sha256Hex(pdfBytes);
    const geom = geometry.readings[slug];
    if (!geom) throw new Error(`no geometry for reading "${slug}"`);

    const destDir = join(READERS, slug);
    copyViewerBundle(destDir);

    // Data files, in the exact public shape the viewer's load.ts validates.
    const manifest = {
      schemaVersion: SCHEMA_VERSION,
      viewerSchemaVersion: SCHEMA_VERSION,
      title,
      source: { sha256, pageCount: geom.pageCount, sourceRevision: 1 },
      // Reader lives at readers/<slug>/; the shelf index is two levels up. A
      // relative link keeps the whole tree deployable at any base path (the
      // reader validates this is relative before using it — see load.ts).
      home: '../../index.html',
    };
    const annotations = reading.notes.map((n) =>
      buildAnnotation(n, sha256, pageSize, geom.lines),
    );
    // Deterministic reading order: page, then top-down, then id.
    annotations.sort((a, b) => {
      const ap = a.anchor.pageIndex, bp = b.anchor.pageIndex;
      if (ap !== bp) return ap - bp;
      const ay = topY(a.anchor), by = topY(b.anchor);
      if (ay !== by) return by - ay;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });

    writeFileSync(join(destDir, 'document.pdf'), pdfBytes);
    writeFileSync(join(destDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    writeFileSync(join(destDir, 'annotations.json'), JSON.stringify(annotations, null, 2) + '\n');

    const tags = [...new Set(reading.notes.flatMap((n) => n.tags ?? []))];
    cards.push({ slug, title, byline: reading.byline ?? '', pageCount: geom.pageCount, noteCount: annotations.length, tags });
    console.log(`built reader: readers/${slug}/ (sha256 ${sha256.slice(0, 12)}…, ${annotations.length} notes)`);
  }

  writeFileSync(join(EXAMPLES, 'index.html'), bookshelfHtml(cards));
  writeFileSync(join(EXAMPLES, '.nojekyll'), '');
  console.log(`built bookshelf: examples/index.html (${cards.length} readings)`);
}

function topY(anchor) {
  if (anchor.kind === 'text') {
    let m = -Infinity;
    for (const q of anchor.quads) for (const [, y] of q) if (y > m) m = y;
    return m;
  }
  if (anchor.kind === 'region') {
    let m = -Infinity;
    for (const [, y] of anchor.quad) if (y > m) m = y;
    return m;
  }
  return anchor.point[1];
}

main();
