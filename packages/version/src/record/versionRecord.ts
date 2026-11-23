import fs from 'node:fs';
import path from 'node:path';
import semver from 'semver';
import { z } from 'zod';

export const VERSION_RECORD_FILE = 'releasekit.versions.json';

const SemverSchema = z
  .string()
  .refine((version) => semver.valid(version) === version, 'not a semver version, such as 1.2.3');

const VersionRecordEntrySchema = z.looseObject({
  name: z.string(),
  version: SemverSchema,
  at: z.string(),
  lastStable: z.looseObject({ version: SemverSchema, at: z.string() }).optional(),
});

const VersionRecordSchema = z.record(z.string(), VersionRecordEntrySchema);

/** `lastStable` is set only on a prerelease entry whose package has had a stable release. */
export interface VersionRecordEntry {
  name: string;
  version: string;
  at: string;
  lastStable?: { version: string; at: string };
}

/** Entries keyed by package path relative to the project root, `.` for a package at the root. */
export type VersionRecordEntries = Record<string, VersionRecordEntry>;

export function versionRecordPath(root: string): string {
  return path.join(root, VERSION_RECORD_FILE);
}

export function versionRecordKey(root: string, packageDir: string): string {
  return path.relative(root, packageDir).split(path.sep).join('/') || '.';
}

/** An empty record when the file doesn't exist. */
export function readVersionRecord(root: string): VersionRecordEntries {
  const file = versionRecordPath(root);
  if (!fs.existsSync(file)) {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (error) {
    throw new Error(`${VERSION_RECORD_FILE} isn't valid JSON: ${error instanceof Error ? error.message : error}`);
  }
  const result = VersionRecordSchema.safeParse(parsed);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new Error(`${VERSION_RECORD_FILE} is malformed at "${issue?.path.join('.')}": ${issue?.message}`);
  }
  return result.data;
}

export function serializeVersionRecord(record: VersionRecordEntries): string {
  const sorted = Object.fromEntries(
    Object.keys(record)
      .sort()
      .map((key) => [key, record[key]]),
  );
  return `${JSON.stringify(sorted, null, 2)}\n`;
}

/** A prerelease keeps the last stable release: the previous entry if that was stable, else what it carried. */
export function recordRelease(
  previous: VersionRecordEntry | undefined,
  name: string,
  version: string,
  at: string,
): VersionRecordEntry {
  const entry: VersionRecordEntry = { name, version, at };
  if (semver.prerelease(version) && previous) {
    const lastStable = semver.prerelease(previous.version)
      ? previous.lastStable
      : { version: previous.version, at: previous.at };
    if (lastStable) {
      entry.lastStable = lastStable;
    }
  }
  return entry;
}
