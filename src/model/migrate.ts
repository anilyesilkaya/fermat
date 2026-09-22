import { z } from 'zod';
import { ProjectFile, SCHEMA_VERSION } from './schema';

/**
 * Schema migration entry point.
 *
 * Today there is exactly one schema version, so migration only validates. When a
 * breaking change lands, add a step keyed by the incoming `schemaVersion` and
 * chain forward to SCHEMA_VERSION. Migration must be explicit and lossless-or-
 * refusing: never silently drop data, and never reinterpret geometry.
 */

export class SchemaMigrationError extends Error {
  constructor(
    message: string,
    readonly fromVersion: unknown,
  ) {
    super(message);
    this.name = 'SchemaMigrationError';
  }
}

/** Read just the version tag without trusting the rest of the payload. */
const VersionTag = z.object({ schemaVersion: z.number().int() });

/**
 * Validate and, if needed, migrate an unknown parsed-JSON value into a current
 * ProjectFile. Throws `SchemaMigrationError` for an unsupported/absent version
 * and a `ZodError` for structural problems at the current version.
 */
export function migrateProjectFile(input: unknown): z.infer<typeof ProjectFile> {
  const tag = VersionTag.safeParse(input);
  if (!tag.success) {
    throw new SchemaMigrationError(
      'missing or invalid schemaVersion; cannot determine how to read this project',
      undefined,
    );
  }

  const version = tag.data.schemaVersion;
  if (version > SCHEMA_VERSION) {
    throw new SchemaMigrationError(
      `project schema version ${version} is newer than supported ${SCHEMA_VERSION}; upgrade Fermat`,
      version,
    );
  }

  switch (version) {
    case SCHEMA_VERSION:
      // Structural validation; throws ZodError on mismatch.
      return ProjectFile.parse(input);
    default:
      throw new SchemaMigrationError(
        `no migration path from schema version ${version}`,
        version,
      );
  }
}
