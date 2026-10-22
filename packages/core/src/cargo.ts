import fs from 'node:fs';
import path from 'node:path';

/** A `Cargo.toml` declares a workspace when it has a `[workspace]` (or `[workspace.*]`) table. */
function isWorkspaceManifest(cargoTomlPath: string): boolean {
  try {
    return /^\s*\[workspace[\].]/m.test(fs.readFileSync(cargoTomlPath, 'utf8'));
  } catch {
    return false;
  }
}

/**
 * Find the `Cargo.lock` that governs a crate at `startDir` — the one cargo resolves the crate
 * into — by walking up from `startDir`:
 *
 * - If an ancestor `Cargo.toml` declares a `[workspace]`, that's the workspace root and its
 *   `Cargo.lock` is authoritative. A workspace member's own (stray) lock is ignored by cargo, so we
 *   must not target it — only the root lock actually moves.
 * - Otherwise (a standalone crate, no workspace) the nearest committed `Cargo.lock` governs.
 *
 * Returns `undefined` when no committed lock governs the crate. That is deliberate: libraries
 * commonly don't commit a lock, and a version bump must never *create* one as a side effect — only
 * sync an existing committed lock so it doesn't drift.
 */
export function findCargoLockfile(startDir: string): string | undefined {
  let dir = path.resolve(startDir);
  let nearestLock: string | undefined;
  while (true) {
    const lockPath = path.join(dir, 'Cargo.lock');
    const hasLock = fs.existsSync(lockPath);
    if (hasLock && !nearestLock) nearestLock = lockPath;

    const cargoToml = path.join(dir, 'Cargo.toml');
    if (fs.existsSync(cargoToml) && isWorkspaceManifest(cargoToml)) {
      // Workspace root: its lock is the one cargo updates (or none, if no lock is committed).
      return hasLock ? lockPath : undefined;
    }

    const parent = path.dirname(dir);
    if (parent === dir) break; // reached the filesystem root
    dir = parent;
  }
  return nearestLock;
}

interface CargoLockEntry {
  name: string;
  version: string;
  /** Index of the entry's `version = "…"` line. */
  versionLine: number;
  /** Registry and git packages carry a `source`; path and workspace packages don't. */
  hasSource: boolean;
}

/** Read the `[[package]]` entries of a Cargo.lock split into lines, keeping each line's position. */
function readCargoLockEntries(lines: string[]): CargoLockEntry[] {
  const entries: CargoLockEntry[] = [];
  let current: { name?: string; version?: string; versionLine?: number; hasSource: boolean } | undefined;
  const closeEntry = (): void => {
    if (current?.name !== undefined && current.version !== undefined && current.versionLine !== undefined) {
      entries.push({
        name: current.name,
        version: current.version,
        versionLine: current.versionLine,
        hasSource: current.hasSource,
      });
    }
  };

  for (const [index, line] of lines.entries()) {
    if (line.startsWith('[')) {
      closeEntry();
      current = /^\[\[package\]\]\s*$/.test(line) ? { hasSource: false } : undefined;
      continue;
    }
    const field = current ? /^(name|version|source) = "([^"]*)"\s*$/.exec(line) : null;
    if (!current || !field) {
      continue;
    }
    if (field[1] === 'name') {
      current.name = field[2];
    } else if (field[1] === 'version') {
      current.version = field[2];
      current.versionLine = index;
    } else {
      current.hasSource = true;
    }
  }
  closeEntry();
  return entries;
}

/**
 * Point a path or workspace crate's own `[[package]]` entry in Cargo.lock content at `version`, making
 * the edit cargo itself makes for a version change: the entry's `version` line, plus every
 * `"<name> <old version>"` dependency reference. Cargo only writes the version into a reference when
 * the lock holds more than one version of that name — otherwise dependents list the bare name, which
 * needs no edit. That encoding is the same in every lockfile format, and cargo never adds a source to
 * a reference to a path package. Registry and git entries of the same name are never touched.
 *
 * Returns the updated content (identical when the entry is already at `version`), or `undefined` when
 * the lock has no path entry for `crateName`. Throws rather than guess when the lock holds the name
 * more than once in a way this edit would change cargo's encoding of: several path entries, or another
 * entry at the old or new version (those references carry a source that would have to be added or
 * dropped).
 */
export function setCargoLockVersion(lockContent: string, crateName: string, version: string): string | undefined {
  const lines = lockContent.split('\n');
  const sameName = readCargoLockEntries(lines).filter((entry) => entry.name === crateName);
  const own = sameName.filter((entry) => !entry.hasSource);
  if (own.length === 0) {
    return undefined;
  }
  if (own.length > 1) {
    throw new Error(`Cargo.lock has ${own.length} path entries named ${crateName}`);
  }

  const [entry] = own;
  if (entry.version === version) {
    return lockContent;
  }
  const clash = sameName.find((other) => other !== entry && [entry.version, version].includes(other.version));
  if (clash) {
    throw new Error(
      `Cargo.lock also has ${crateName} ${clash.version} from another source; run \`cargo update --workspace\` to sync it`,
    );
  }

  lines[entry.versionLine] = lines[entry.versionLine].replace(`"${entry.version}"`, `"${version}"`);
  return lines.join('\n').replaceAll(`"${crateName} ${entry.version}"`, `"${crateName} ${version}"`);
}

/**
 * Sync the crate's own entry in the committed Cargo.lock that governs `crateDir` (see
 * {@link findCargoLockfile}) to `version`, by editing the lock text directly with
 * {@link setCargoLockVersion}. Nothing runs cargo, so this needs no Rust toolchain, registry index or
 * network. Writes nothing under `dryRun`.
 *
 * Returns the lock path and whether its content changed, or `undefined` when no committed lock lists
 * the crate as a path package. Throws when the lock can't be read or written, or can't be edited
 * unambiguously.
 */
export function syncCargoLockVersion(
  crateDir: string,
  crateName: string,
  version: string,
  dryRun = false,
): { lockPath: string; changed: boolean } | undefined {
  const lockPath = findCargoLockfile(crateDir);
  if (!lockPath) {
    return undefined;
  }
  const content = fs.readFileSync(lockPath, 'utf8');
  const updated = setCargoLockVersion(content, crateName, version);
  if (updated === undefined) {
    return undefined;
  }
  const changed = updated !== content;
  if (changed && !dryRun) {
    fs.writeFileSync(lockPath, updated);
  }
  return { lockPath, changed };
}
