import fs from 'node:fs';
import path from 'node:path';
import type { Package } from '@manypkg/get-packages';
import semver from 'semver';
import { z } from 'zod';
import { writeVersionFile } from '../utils/jsonOutput.js';

export const VERSION_RECORD_FILE = 'releasekit.versions.json';

const VersionRecordEntrySchema = z.looseObject({
  name: z.string(),
  version: z.string(),
  at: z.string(),
  lastStable: z.looseObject({ version: z.string(), at: z.string() }).optional(),
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
export type VersionRecord = Record<string, VersionRecordEntry>;

export function versionRecordPath(root: string): string {
  return path.join(root, VERSION_RECORD_FILE);
}

export function versionRecordKey(root: string, packageDir: string): string {
  return path.relative(root, packageDir).split(path.sep).join('/') || '.';
}

/** An empty record when the file doesn't exist. */
export function readVersionRecord(root: string): VersionRecord {
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

export function serializeVersionRecord(record: VersionRecord): string {
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

/**
 * Records each released package in `record` at `at`, the commit its release was computed at. A name that isn't a
 * package, such as a monorepo's root manifest, gets no entry. Nothing is written when nothing was released.
 */
export async function writeReleasedVersions(
  record: VersionRecord,
  at: string,
  releasedVersions: ReadonlyMap<string, string>,
  packages: Package[],
  root: string,
  dryRun: boolean,
): Promise<void> {
  const released = [...releasedVersions].flatMap(([name, version]) => {
    const pkg = packages.find((p) => p.packageJson.name === name);
    return pkg ? [{ key: versionRecordKey(root, pkg.dir), name, version }] : [];
  });
  if (released.length === 0) {
    return;
  }
  const updated = { ...record };
  for (const { key, name, version } of released) {
    updated[key] = recordRelease(updated[key], name, version, at);
  }
  writeVersionFile(versionRecordPath(root), serializeVersionRecord(updated), dryRun);
}
