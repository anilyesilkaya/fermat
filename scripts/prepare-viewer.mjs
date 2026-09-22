/**
 * Prepare the pre-built viewer for consumption by the author app.
 *
 * The author app assembles a published reading in the browser by fetching the
 * already-built viewer files and packing them into the export ZIP. A browser
 * cannot enumerate a directory, so this script (run after the viewer build):
 *
 *   1. copies dist-viewer/ → public/viewer/  (served as static author assets)
 *   2. writes public/viewer/manifest.json     (the file list the author fetches)
 *   3. writes public/viewer/THIRD_PARTY_NOTICES.txt from bundled deps' licenses
 *
 * Keeping this out of the author bundle graph preserves the separation: the
 * author never imports viewer source; it treats the viewer as opaque artifacts.
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { fileURLToPath, URL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const distViewer = `${root}/dist-viewer`;
const outDir = `${root}/public/viewer`;

if (!existsSync(distViewer)) {
  console.error('dist-viewer/ not found — run the viewer build first (vite build --config vite.viewer.config.ts).');
  process.exit(1);
}

// 1) Fresh copy.
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
cpSync(distViewer, outDir, { recursive: true });

// 2) Manifest: every file path relative to the viewer root, POSIX-separated.
function walk(dir, base = '') {
  const files = [];
  for (const name of readdirSync(dir)) {
    const abs = `${dir}/${name}`;
    const rel = base ? `${base}/${name}` : name;
    if (statSync(abs).isDirectory()) files.push(...walk(abs, rel));
    else files.push(rel);
  }
  return files;
}
const files = walk(outDir)
  .filter((f) => f !== 'manifest.json')
  .sort();
writeFileSync(`${outDir}/manifest.json`, JSON.stringify({ files }, null, 2));

// 3) Third-party notices for the software actually bundled into every reading.
const BUNDLED = ['pdfjs-dist', 'katex'];
const parts = [
  'Fermat published reading — third-party software notices',
  '',
  'This reading bundles the following open-source software so it can render',
  'offline with no external requests. Their licenses are reproduced below.',
  '',
];
for (const pkg of BUNDLED) {
  const dir = `${root}/node_modules/${pkg}`;
  let version = 'unknown';
  try {
    version = JSON.parse(readFileSync(`${dir}/package.json`, 'utf8')).version ?? version;
  } catch {
    // best effort
  }
  const licenseFile = ['LICENSE', 'LICENSE.txt', 'LICENSE.md', 'license'].find((n) =>
    existsSync(`${dir}/${n}`),
  );
  const license = licenseFile ? readFileSync(`${dir}/${licenseFile}`, 'utf8').trim() : '(license file not found)';
  parts.push('='.repeat(72), `${pkg} @ ${version}`, '='.repeat(72), '', license, '');
}
writeFileSync(`${outDir}/THIRD_PARTY_NOTICES.txt`, parts.join('\n'));

console.log(`Prepared viewer: ${files.length} files → public/viewer/`);
