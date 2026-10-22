import fs from 'node:fs';
import path from 'node:path';
import * as TOML from 'smol-toml';

interface CargoWorkspace {
  members?: unknown;
  exclude?: unknown;
}

/** The `[workspace]` table of the manifest at `cargoTomlPath`, if it exists and declares one. */
function readWorkspace(cargoTomlPath: string): CargoWorkspace | undefined {
  try {
    return (TOML.parse(fs.readFileSync(cargoTomlPath, 'utf8')) as { workspace?: CargoWorkspace }).workspace;
  } catch {
    return undefined;
  }
}

/**
 * Cargo's `is_excluded`: an `exclude` entry is a path prefix of the manifest and no `members` entry is.
 * Cargo matches both literally, without expanding globs.
 */
function isExcluded(workspace: CargoWorkspace, rootDir: string, manifestPath: string): boolean {
  const covers = (entries: unknown): boolean =>
    Array.isArray(entries) &&
    entries.some((entry) => {
      const prefix = typeof entry === 'string' ? path.resolve(rootDir, entry) : undefined;
      return prefix !== undefined && (manifestPath === prefix || manifestPath.startsWith(prefix + path.sep));
    });
  return covers(workspace.exclude) && !covers(workspace.members);
}

/**
 * Find the `Cargo.lock` that governs the crate at `crateDir` — the one cargo resolves the crate into,
 * at its workspace root. Cargo's rule: a crate whose own manifest has a `[workspace]` is its own root;
 * otherwise the nearest ancestor `[workspace]` that doesn't exclude it is, and with none the crate is
 * its own root. Cargo ignores every other lock: a member's stray one, or one in an ancestor directory
 * that isn't the root. A `package.workspace = "<path>"` pointer isn't followed.
 *
 * Returns `undefined` when the root has no lock. That is deliberate: libraries commonly don't commit a
 * lock, and a version bump must never *create* one as a side effect — only sync an existing committed
 * lock so it doesn't drift.
 */
export function findCargoLockfile(crateDir: string): string | undefined {
  const manifestPath = path.join(path.resolve(crateDir), 'Cargo.toml');
  let root = path.dirname(manifestPath);
  if (!readWorkspace(manifestPath)) {
    for (let dir = root; path.dirname(dir) !== dir; ) {
      dir = path.dirname(dir);
      const workspace = readWorkspace(path.join(dir, 'Cargo.toml'));
      if (workspace && !isExcluded(workspace, dir, manifestPath)) {
        root = dir;
        break;
      }
    }
  }
  const lockPath = path.join(root, 'Cargo.lock');
  return fs.existsSync(lockPath) ? lockPath : undefined;
}

interface CargoLockEntry {
  name: string;
  version: string;
  /** Index of the entry's `[[package]]` line. */
  start: number;
  /** Index of the entry's last non-blank line. */
  end: number;
  /** Index of the entry's `version = "…"` line. */
  versionLine: number;
  /** Registry and git packages carry a `source`; path and workspace packages don't. */
  hasSource: boolean;
}

/** Read the `[[package]]` entries of a Cargo.lock split into lines, keeping each line's position. */
function readCargoLockEntries(lines: string[]): CargoLockEntry[] {
  const entries: CargoLockEntry[] = [];
  let current: (Partial<CargoLockEntry> & { start: number; end: number; hasSource: boolean }) | undefined;
  const closeEntry = (): void => {
    if (current?.name !== undefined && current.version !== undefined && current.versionLine !== undefined) {
      entries.push({
        name: current.name,
        version: current.version,
        start: current.start,
        end: current.end,
        versionLine: current.versionLine,
        hasSource: current.hasSource,
      });
    }
  };

  for (const [index, line] of lines.entries()) {
    if (line.startsWith('[')) {
      closeEntry();
      current = /^\[\[package\]\]\s*$/.test(line) ? { start: index, end: index, hasSource: false } : undefined;
      continue;
    }
    if (!current) {
      continue;
    }
    if (line.trim() !== '') {
      current.end = index;
    }
    const field = /^(name|version|source) = "([^"]*)"\s*$/.exec(line);
    if (field?.[1] === 'name') {
      current.name = field[2];
    } else if (field?.[1] === 'version') {
      current.version = field[2];
      current.versionLine = index;
    } else if (field?.[1] === 'source') {
      current.hasSource = true;
    }
  }
  closeEntry();
  return entries;
}

/** Split a version into its numeric core, pre-release identifiers and build metadata. */
function parseVersion(version: string): { core: number[]; pre: string[]; build: string } {
  const plus = version.indexOf('+');
  const withoutBuild = plus === -1 ? version : version.slice(0, plus);
  const dash = withoutBuild.indexOf('-');
  return {
    core: (dash === -1 ? withoutBuild : withoutBuild.slice(0, dash)).split('.').map(Number),
    pre: dash === -1 ? [] : withoutBuild.slice(dash + 1).split('.'),
    build: plus === -1 ? '' : version.slice(plus + 1),
  };
}

const compareStrings = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Semver precedence, which is how cargo orders same-name `[[package]]` entries: numeric core, then a
 * pre-release sorts before the release, identifier by identifier (numeric ones numerically and before
 * alphanumeric ones). Build metadata only breaks ties.
 */
function compareVersions(a: string, b: string): number {
  const left = parseVersion(a);
  const right = parseVersion(b);
  for (let i = 0; i < 3; i++) {
    if (left.core[i] !== right.core[i]) {
      return left.core[i] - right.core[i];
    }
  }
  if (left.pre.length === 0 || right.pre.length === 0) {
    return right.pre.length - left.pre.length || compareStrings(left.build, right.build);
  }
  for (let i = 0; i < Math.min(left.pre.length, right.pre.length); i++) {
    const [x, y] = [left.pre[i], right.pre[i]];
    const [xNumeric, yNumeric] = [/^\d+$/.test(x), /^\d+$/.test(y)];
    if (xNumeric && yNumeric && x !== y) {
      return x.length - y.length || compareStrings(x, y);
    }
    if (xNumeric !== yNumeric) {
      return xNumeric ? -1 : 1;
    }
    if (x !== y) {
      return compareStrings(x, y);
    }
  }
  return left.pre.length - right.pre.length || compareStrings(left.build, right.build);
}

/**
 * Put same-name `[[package]]` entries back in cargo's order (by version) after one of them changed
 * version. They sit next to each other, so the entries are permuted while the blank lines between
 * them stay put. A lock not laid out that way is left as it is.
 */
function sortSameNameEntries(lines: string[], group: Array<{ entry: CargoLockEntry; version: string }>): void {
  const gaps = group.slice(1).map(({ entry }, i) => lines.slice(group[i].entry.end + 1, entry.start));
  if (gaps.some((gap) => gap.some((line) => line.trim() !== ''))) {
    return;
  }
  const blocks = group.map(({ entry }) => lines.slice(entry.start, entry.end + 1));
  const order = group.map((_, i) => i).sort((a, b) => compareVersions(group[a].version, group[b].version));
  const region = order.flatMap((blockIndex, slot) => [...(slot === 0 ? [] : gaps[slot - 1]), ...blocks[blockIndex]]);
  const first = group[0].entry.start;
  lines.splice(first, group[group.length - 1].entry.end + 1 - first, ...region);
}

/**
 * Put the run of `name` references around each `"<name> <version>"` dependency line back in cargo's
 * order. Cargo sorts a package's dependencies by name and then by the version as a string, so
 * `"foo 10.0.0"` sorts before `"foo 2.0.0"`.
 */
function sortReferenceRuns(lines: string[], name: string, version: string): void {
  const referenceVersion = (line: string): string | undefined => {
    const reference = /^\s*"([^" ]+) ([^" ]+)[^"]*",?\s*$/.exec(line);
    return reference?.[1] === name ? reference[2] : undefined;
  };
  for (let i = 0; i < lines.length; i++) {
    if (referenceVersion(lines[i]) !== version) {
      continue;
    }
    let first = i;
    while (first > 0 && referenceVersion(lines[first - 1]) !== undefined) {
      first--;
    }
    let last = i;
    while (last + 1 < lines.length && referenceVersion(lines[last + 1]) !== undefined) {
      last++;
    }
    const run = lines.slice(first, last + 1);
    const sorted = [...run].sort((a, b) => compareStrings(referenceVersion(a) ?? '', referenceVersion(b) ?? ''));
    lines.splice(first, run.length, ...sorted);
    i = last;
  }
}

/**
 * Point a path or workspace crate's own `[[package]]` entry in Cargo.lock content at `version`, making
 * the edit cargo itself makes for a version change: the entry's `version` line, plus every
 * `"<name> <old version>"` dependency reference. Cargo only writes the version into a reference when
 * the lock holds more than one version of that name — otherwise dependents list the bare name, which
 * needs no edit. That encoding is the same in every lockfile format, and cargo never adds a source to
 * a reference to a path package. Registry and git entries of the same name are never touched, but
 * when the new version passes one of theirs, the entries and references are put back in cargo's order.
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
    throw new Error(`it has ${own.length} path entries named ${crateName}`);
  }

  const [entry] = own;
  if (entry.version === version) {
    return lockContent;
  }
  const clash = sameName.find((other) => other !== entry && [entry.version, version].includes(other.version));
  if (clash) {
    throw new Error(`it also has ${crateName} ${clash.version} from another source`);
  }

  lines[entry.versionLine] = lines[entry.versionLine].replace(`"${entry.version}"`, `"${version}"`);
  if (sameName.length > 1) {
    sortSameNameEntries(
      lines,
      sameName.map((other) => ({ entry: other, version: other === entry ? version : other.version })),
    );
  }
  const updated = lines
    .join('\n')
    .replaceAll(`"${crateName} ${entry.version}"`, `"${crateName} ${version}"`)
    .split('\n');
  if (sameName.length > 1) {
    sortReferenceRuns(updated, crateName, version);
  }
  return updated.join('\n');
}

/** The part of `@releasekit/git`'s `Git` seam the Cargo.lock sync uses (core doesn't depend on it). */
export interface CargoLockGit {
  isRepository(cwd?: string): Promise<boolean>;
  lsFiles(opts?: { paths?: string[]; cwd?: string }): Promise<string[]>;
  isIgnored(file: string, cwd?: string): Promise<boolean>;
}

/** A crate whose new version the Cargo.lock files that record it must follow. */
export interface CargoLockBump {
  cargoTomlPath: string;
  name: string;
  version: string;
  /** The version the manifest had before the bump; absent when it records none (`version.workspace = true`). */
  fromVersion?: string;
}

/** A Cargo.lock that lists at least one bumped crate as a path package, with the content it must have. */
export interface CargoLockUpdate {
  lockPath: string;
  content: string;
  changed: boolean;
}

/**
 * Work out the content of every Cargo.lock that records a bumped crate, by editing the lock text with
 * {@link setCargoLockVersion} — nothing runs cargo, so no Rust toolchain, registry index or network is
 * needed. The candidates are every lock git tracks (apps that use a crate through a path dependency
 * have their own) plus each crate's own lock ({@link findCargoLockfile}), which is synced even when
 * untracked but not when git ignores it, since it couldn't be staged.
 *
 * Crates in different workspaces can share a name (every `tauri init` app is `app`). A crate's own lock
 * always takes its bump; in any other lock, an entry of that name follows the bump only when something
 * in that lock depends on it (one nothing depends on is that lock's own root or a member) at the
 * crate's old or new version (any version when neither its manifest nor its own lock records the old
 * one). A different crate of the same name used by path at a matching version can't be told apart.
 * A lock gets every bump it records, so a lock shared by several bumped crates is rewritten once;
 * locks that record none are left out.
 *
 * Nothing is written: the caller writes the changed content. Throws, naming the lock, when a lock can't
 * be read or edited unambiguously, so no lock is written unless every lock can be.
 */
export async function planCargoLockUpdates(
  git: CargoLockGit,
  cwd: string,
  bumps: CargoLockBump[],
): Promise<CargoLockUpdate[]> {
  const lockPaths = new Set<string>();
  if (await git.isRepository(cwd)) {
    for (const lockPath of await git.lsFiles({ paths: [':(top,glob)**/Cargo.lock'], cwd })) {
      lockPaths.add(path.resolve(cwd, lockPath));
    }
  }
  const owners = new Map<string, CargoLockBump[]>();
  const fromVersions = new Map<CargoLockBump, string | undefined>();
  for (const bump of bumps) {
    fromVersions.set(bump, bump.fromVersion);
    const ownLock = findCargoLockfile(path.dirname(bump.cargoTomlPath));
    if (ownLock && !(await git.isIgnored(ownLock, cwd))) {
      owners.set(ownLock, [...(owners.get(ownLock) ?? []), bump]);
      lockPaths.add(ownLock);
      // A manifest that inherits its version, or has none, doesn't say what the crate was at.
      fromVersions.set(
        bump,
        fromVersions.get(bump) ??
          readCargoLockEntries(fs.readFileSync(ownLock, 'utf8').split('\n')).find(
            (entry) => entry.name === bump.name && !entry.hasSource,
          )?.version,
      );
    }
  }

  const updates: CargoLockUpdate[] = [];
  for (const lockPath of lockPaths) {
    // Tracked but deleted in the work tree: nothing to sync.
    if (!fs.existsSync(lockPath)) {
      continue;
    }
    const original = fs.readFileSync(lockPath, 'utf8');
    const lines = original.split('\n');
    const pathEntries = readCargoLockEntries(lines).filter((entry) => !entry.hasSource);
    const references = new Set(lines.map((line) => line.trim().replace(/,$/, '')));
    const isPathDependency = (bump: CargoLockBump): boolean => {
      const fromVersion = fromVersions.get(bump);
      return pathEntries.some(
        (entry) =>
          entry.name === bump.name &&
          (fromVersion === undefined || [fromVersion, bump.version].includes(entry.version)) &&
          (references.has(`"${entry.name}"`) || references.has(`"${entry.name} ${entry.version}"`)),
      );
    };

    let content = original;
    let listed = false;
    for (const name of new Set(bumps.map((bump) => bump.name))) {
      const sameName = bumps.filter((bump) => bump.name === name);
      const own = sameName.filter((bump) => owners.get(lockPath)?.includes(bump));
      const matching = own.length > 0 ? own : sameName.filter(isPathDependency);
      if (matching.length === 0) {
        continue;
      }
      if (new Set(matching.map((bump) => bump.version)).size > 1) {
        const manifests = matching.map((bump) => bump.cargoTomlPath).join(', ');
        throw new Error(`can't set ${name} in ${lockPath}: it could be the crate at any of ${manifests}`);
      }
      const [{ version }] = matching;
      let next: string | undefined;
      try {
        next = setCargoLockVersion(content, name, version);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`can't set ${name} to ${version} in ${lockPath}: ${detail}`);
      }
      if (next !== undefined) {
        listed = true;
        content = next;
      }
    }
    if (listed) {
      updates.push({ lockPath, content, changed: content !== original });
    }
  }
  return updates;
}
