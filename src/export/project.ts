import { buildZip, readZipSafe, textEntry, entryToText, type ZipEntries } from './archive';
import { sha256Hex } from '../model/hash';
import { migrateProjectFile } from '../model/migrate';
import type { Annotation, DocumentMeta, ProjectFile, ReaderState } from '../model/schema';
import { SCHEMA_VERSION } from '../model/schema';

/**
 * Editable project (backup) archive.
 *
 * Layout inside the ZIP:
 *   project.json            versioned metadata + all annotations + reader state
 *   document.pdf            original, immutable PDF bytes
 *   manifest.json           file sizes + checksums for integrity
 *   assets/…                local note assets (optional)
 *
 * This backup MAY contain private information (all annotations, drafts-turned-
 * notes, the original filename). It is explicitly labeled as such by the author
 * UI. On import we validate before mutating anything and never silently
 * overwrite a newer note.
 */

export const PROJECT_PDF_PATH = 'document.pdf';
export const PROJECT_JSON_PATH = 'project.json';
export const PROJECT_MANIFEST_PATH = 'manifest.json';

export interface ProjectManifestEntry {
  path: string;
  bytes: number;
  sha256: string;
}

export interface ProjectManifest {
  kind: 'fermat-project';
  schemaVersion: number;
  files: ProjectManifestEntry[];
}

export interface ExportProjectInput {
  document: DocumentMeta;
  annotations: readonly Annotation[];
  readerState?: ReaderState;
  pdfBytes: Uint8Array;
  /** Optional local note assets, keyed by relative path under assets/. */
  assets?: ZipEntries;
}

/** Serialize JSON deterministically (stable key order) for reproducible output. */
function stableJson(value: unknown): string {
  return JSON.stringify(sortKeys(value), null, 2);
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/** Build a project backup ZIP. Async because it hashes each file for the manifest. */
export async function exportProject(input: ExportProjectInput): Promise<Uint8Array> {
  const project: ProjectFile = {
    schemaVersion: SCHEMA_VERSION,
    document: input.document,
    annotations: [...input.annotations],
    ...(input.readerState ? { readerState: input.readerState } : {}),
  };

  const entries: ZipEntries = {};
  entries[PROJECT_JSON_PATH] = textEntry(stableJson(project));
  entries[PROJECT_PDF_PATH] = input.pdfBytes;
  if (input.assets) {
    for (const [name, bytes] of Object.entries(input.assets)) {
      entries[`assets/${name}`] = bytes;
    }
  }

  // Manifest lists every OTHER file with size + checksum.
  const files: ProjectManifestEntry[] = [];
  for (const path of Object.keys(entries).sort()) {
    files.push({
      path,
      bytes: entries[path]!.length,
      sha256: await sha256Hex(entries[path]!),
    });
  }
  const manifest: ProjectManifest = {
    kind: 'fermat-project',
    schemaVersion: SCHEMA_VERSION,
    files,
  };
  entries[PROJECT_MANIFEST_PATH] = textEntry(stableJson(manifest));

  return buildZip(entries);
}

export class ProjectImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectImportError';
  }
}

export interface ImportedProject {
  project: ProjectFile;
  pdfBytes: Uint8Array;
  assets: ZipEntries;
}

/**
 * Import + validate a project backup ZIP.
 *
 * Steps (all before returning any data to mutate app state):
 *   1. Safe unzip (path traversal + size budget) — see archive/zip-safety.
 *   2. Parse & migrate project.json against the schema (throws on mismatch).
 *   3. Verify the PDF's actual SHA-256 matches the document's recorded digest —
 *      a mismatch fails loudly (never silently attach notes to a different PDF).
 */
export async function importProject(archive: Uint8Array): Promise<ImportedProject> {
  const entries = readZipSafe(archive);

  const projectRaw = entries[PROJECT_JSON_PATH];
  if (!projectRaw) throw new ProjectImportError('missing project.json');
  const pdfBytes = entries[PROJECT_PDF_PATH];
  if (!pdfBytes) throw new ProjectImportError('missing document.pdf');

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(entryToText(projectRaw));
  } catch {
    throw new ProjectImportError('project.json is not valid JSON');
  }

  let project: ProjectFile;
  try {
    project = migrateProjectFile(parsedJson);
  } catch (err) {
    throw new ProjectImportError(
      `project.json failed schema validation: ${(err as Error).message}`,
    );
  }

  // Integrity: the bytes must match the recorded identity.
  const actualSha = await sha256Hex(pdfBytes);
  if (actualSha !== project.document.sha256) {
    throw new ProjectImportError(
      `PDF hash mismatch: archive contains ${actualSha} but project records ${project.document.sha256}`,
    );
  }

  const assets: ZipEntries = {};
  for (const [path, bytes] of Object.entries(entries)) {
    if (path.startsWith('assets/')) assets[path.slice('assets/'.length)] = bytes;
  }

  return { project, pdfBytes, assets };
}
