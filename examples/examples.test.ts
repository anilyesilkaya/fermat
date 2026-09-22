import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { Anchor, Sha256 } from '../src/model/schema';

/**
 * Guards for the generated demo bookshelf (examples/). These prove that every
 * built reader is a valid, self-contained publication BEFORE it ships to a
 * static host — using the SAME public shape the viewer's load.ts enforces at
 * runtime, and the SAME anchor schema the renderer consumes.
 *
 * The readers are a build artifact (scripts/build-examples.mjs), so this suite
 * skips cleanly when they haven't been generated yet.
 */

const examplesDir = join(process.cwd(), 'examples');
const readersDir = join(examplesDir, 'readers');
const built = existsSync(readersDir) && readdirSync(readersDir).length > 0;

// The public projection shape, mirrored from src/viewer/load.ts (which validates
// exactly this at runtime); anchors reuse the real schema from the model.
const PublicManifest = z.object({
  schemaVersion: z.number().int(),
  viewerSchemaVersion: z.number().int(),
  title: z.string(),
  source: z.object({
    sha256: Sha256,
    pageCount: z.number().int().positive(),
    sourceRevision: z.number().int().positive(),
  }),
});
const PublicAnnotation = z.object({
  schemaVersion: z.number().int(),
  id: z.string(),
  documentSha256: Sha256,
  anchor: Anchor,
  bodyMarkdown: z.string(),
  color: z.string(),
  tags: z.array(z.string()),
});

describe.skipIf(!built)('example bookshelf', () => {
  let slugs: string[] = [];
  beforeAll(() => {
    slugs = readdirSync(readersDir).filter((s) => existsSync(join(readersDir, s, 'index.html')));
  });

  it('has a bookshelf index that links every reader with relative paths', () => {
    const index = readFileSync(join(examplesDir, 'index.html'), 'utf8');
    for (const slug of readdirSync(readersDir)) {
      expect(index).toContain(`./readers/${slug}/index.html`);
    }
    // No absolute or off-origin links from the landing page.
    expect(index).not.toMatch(/href="https?:\/\//);
    expect(index).not.toMatch(/href="\//);
  });

  it('each reader is a self-contained, valid publication', () => {
    expect(slugs.length).toBeGreaterThan(0);
    for (const slug of slugs) {
      const dir = join(readersDir, slug);
      // Required files present.
      for (const f of ['index.html', 'document.pdf', 'manifest.json', 'annotations.json', 'assets/viewer.js']) {
        expect(existsSync(join(dir, f)), `${slug} missing ${f}`).toBe(true);
      }
      // Data validates against the public shape the viewer enforces.
      const manifest = PublicManifest.parse(JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')));
      const annotations = z
        .array(PublicAnnotation)
        .parse(JSON.parse(readFileSync(join(dir, 'annotations.json'), 'utf8')));
      // Every annotation is bound to THIS document's bytes.
      for (const ann of annotations) {
        expect(ann.documentSha256, `${slug}: ${ann.id} sha`).toBe(manifest.source.sha256);
        expect(ann.anchor.pageIndex).toBeLessThan(manifest.source.pageCount);
      }
      // index.html references only relative URLs (no CDN / app-domain).
      const html = readFileSync(join(dir, 'index.html'), 'utf8');
      const urls = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]!);
      for (const u of urls) {
        expect(u.startsWith('./') || u.startsWith('assets/') || !/^[a-z]+:|^\/\//i.test(u)).toBe(true);
      }
    }
  });
});
