/**
 * @vitest-environment node
 *
 * Milestone-1 evidence: export a real reader from real inputs and audit that the
 * output honors the self-contained + no-private-leak contracts.
 *
 * This uses the ACTUAL prepared viewer bundle under public/viewer (produced by
 * the viewer build + scripts/prepare-viewer.mjs). If it hasn't been built yet
 * the suite skips with a clear message rather than silently passing — a skipped
 * gate must never read as a satisfied gate.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { exportReader } from './reader';
import { readZipSafe, entryToText } from './archive';
import type { ZipEntries } from './archive';
import type { Annotation, DocumentMeta } from '../model/schema';

const VIEWER_DIR = fileURLToPath(new URL('../../public/viewer', import.meta.url));
const prepared = existsSync(`${VIEWER_DIR}/manifest.json`) && existsSync(`${VIEWER_DIR}/index.html`);

const SHA = 'c'.repeat(64);
const NOW = '2026-01-01T00:00:00.000Z';

function loadViewerBundle(): ZipEntries {
  const manifest = JSON.parse(readFileSync(`${VIEWER_DIR}/manifest.json`, 'utf8')) as {
    files: string[];
  };
  const entries: ZipEntries = {};
  entries['index.html'] = new Uint8Array(readFileSync(`${VIEWER_DIR}/index.html`));
  for (const rel of manifest.files) {
    entries[rel] = new Uint8Array(readFileSync(`${VIEWER_DIR}/${rel}`));
  }
  return entries;
}

function doc(): DocumentMeta {
  return {
    schemaVersion: 1,
    id: '11111111-1111-4111-8111-111111111111',
    sha256: SHA,
    title: 'Test Reading',
    originalFilename: 'test.pdf',
    byteSize: 4,
    pageCount: 2,
    sourceRevision: 1,
    tags: [],
    readingStatus: 'reading',
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function ann(id: string, publication: 'public' | 'private', body: string): Annotation {
  return {
    schemaVersion: 1,
    id,
    documentSha256: SHA,
    anchor: {
      kind: 'text',
      pageIndex: 0,
      pageViewBox: [0, 0, 612, 792],
      pageRotation: 0,
      userUnit: 1,
      coordinateSpace: 'pdf-user-space',
      quads: [[[10, 700], [100, 700], [100, 680], [10, 680]]],
    },
    bodyMarkdown: body,
    color: '#ffe066',
    tags: [],
    createdAt: NOW,
    updatedAt: NOW,
    publication,
    revision: 1,
  };
}

const SECRET = 'PRIVATE-DO-NOT-PUBLISH-XYZZY';

describe.skipIf(!prepared)('reader export — self-contained + no private leak', () => {
  const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // "%PDF"
  const annotations = [
    ann('22222222-2222-4222-8222-222222222222', 'public', 'A **public** note with $x^2$.'),
    ann('33333333-3333-4333-8333-333333333333', 'private', SECRET),
  ];

  const result = exportReader({
    document: doc(),
    annotations,
    publishedTitle: 'Test Reading',
    pdfBytes,
    viewerBundle: loadViewerBundle(),
    thirdPartyNotices: 'notices',
  });
  const files = readZipSafe(result.zip);

  it('contains exactly the expected top-level reader files', () => {
    expect(files['index.html']).toBeDefined();
    expect(files['document.pdf']).toBeDefined();
    expect(files['manifest.json']).toBeDefined();
    expect(files['annotations.json']).toBeDefined();
    expect(files['notes.md']).toBeDefined();
    expect(files['THIRD_PARTY_NOTICES.txt']).toBeDefined();
    expect(files['assets/viewer.js']).toBeDefined();
  });

  it('does NOT leak the private note into any published artifact', () => {
    for (const [name, bytes] of Object.entries(files)) {
      const text = entryToText(bytes as Uint8Array);
      expect(text.includes(SECRET), `private text leaked into ${name}`).toBe(false);
    }
    // And the projection itself only has the one public note. The public shape
    // has no `publication` field at all (allowlist), so a leak is impossible by
    // construction — verified structurally below via annotations.json keys.
    expect(result.projection.annotations).toHaveLength(1);
    const publicKeys = Object.keys(result.projection.annotations[0]!).sort();
    expect(publicKeys).not.toContain('publication');
  });

  it('index.html references assets with relative URLs only (no external origin, no absolute path)', () => {
    const html = entryToText(files['index.html'] as Uint8Array);
    const srcs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]!);
    expect(srcs.length).toBeGreaterThan(0);
    for (const src of srcs) {
      expect(src.startsWith('http://'), `external URL in index.html: ${src}`).toBe(false);
      expect(src.startsWith('https://'), `external URL in index.html: ${src}`).toBe(false);
      expect(src.startsWith('//'), `protocol-relative URL in index.html: ${src}`).toBe(false);
      expect(src.startsWith('/'), `absolute path in index.html (breaks nested deploy): ${src}`).toBe(false);
    }
  });

  it('the viewer JS contains no hardcoded external origin (CDN) URL', () => {
    const js = entryToText(files['assets/viewer.js'] as Uint8Array);
    // No cdn/unpkg/jsdelivr/googleapis references and no fermat.yesilkaya.dev
    // runtime dependency (the app domain must not be a runtime dependency).
    for (const needle of ['cdnjs', 'unpkg.com', 'jsdelivr', 'googleapis', 'fermat.yesilkaya.dev']) {
      expect(js.includes(needle), `viewer references external origin: ${needle}`).toBe(false);
    }
  });

  it('every asset the manifest lists actually exists in public/viewer (no dangling ref)', () => {
    const manifest = JSON.parse(readFileSync(`${VIEWER_DIR}/manifest.json`, 'utf8')) as {
      files: string[];
    };
    for (const rel of manifest.files) {
      expect(existsSync(`${VIEWER_DIR}/${rel}`), `missing asset ${rel}`).toBe(true);
      expect(statSync(`${VIEWER_DIR}/${rel}`).size).toBeGreaterThan(0);
    }
  });

  it('ships local PDF font + cmap resources (offline rendering)', () => {
    const names = readdirSync(`${VIEWER_DIR}/assets`);
    expect(names.includes('standard_fonts'), 'standard_fonts/ missing from viewer assets').toBe(true);
    expect(names.includes('cmaps'), 'cmaps/ missing from viewer assets').toBe(true);
  });

  it('is byte-deterministic — re-exporting identical input yields an identical ZIP', () => {
    const again = exportReader({
      document: doc(),
      annotations,
      publishedTitle: 'Test Reading',
      pdfBytes,
      viewerBundle: loadViewerBundle(),
      thirdPartyNotices: 'notices',
    });
    expect(Buffer.from(again.zip).equals(Buffer.from(result.zip))).toBe(true);
  });
});
