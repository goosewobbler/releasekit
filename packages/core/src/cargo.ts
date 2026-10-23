import fs from 'node:fs';
import path from 'node:path';
import * as TOML from 'smol-toml';

interface CargoWorkspace {
  members?: unknown;
  exclude?: unknown;
}

type Table = Record<string, unknown>;
type ReadManifest = (cargoTomlPath: string) => Table | undefined;

function readManifest(cargoTomlPath: string): Table | undefined {
  try {
    return TOML.parse(fs.readFileSync(cargoTomlPath, 'utf8'));
  } catch {
    return undefined;
  }
}

const asTable = (value: unknown): Table =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Table) : {};

// Mirrors cargo's `is_excluded`, which matches `exclude` and `members` as literal path prefixes (no globs).
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
 * The crate's workspace root, by cargo's rule: the crate itself if its manifest has a `[workspace]`, else
 * the nearest ancestor `[workspace]` that doesn't exclude it, else the crate. `package.workspace`
 * pointers aren't followed.
 */
function findCargoWorkspaceRoot(crateDir: string, read: ReadManifest = readManifest): string {
  const manifestPath = path.join(path.resolve(crateDir), 'Cargo.toml');
  let root = path.dirname(manifestPath);
  if (!read(manifestPath)?.workspace) {
    for (let dir = root; path.dirname(dir) !== dir; ) {
      dir = path.dirname(dir);
      const workspace = read(path.join(dir, 'Cargo.toml'))?.workspace as CargoWorkspace | undefined;
      if (workspace && !isExcluded(workspace, dir, manifestPath)) {
        root = dir;
        break;
      }
    }
  }
  return root;
}

/**
 * The Cargo.lock at the crate's workspace root. Undefined when the root has no lock: a bump syncs a
 * committed lock but never creates one.
 */
export function findCargoLockfile(crateDir: string): string | undefined {
  const lockPath = path.join(findCargoWorkspaceRoot(crateDir), 'Cargo.lock');
  return fs.existsSync(lockPath) ? lockPath : undefined;
}

const DEPENDENCY_KINDS = ['dependencies', 'dev-dependencies', 'build-dependencies'];

/**
 * Directories of the path crates a lock at `lockRoot` resolves: path dependencies followed transitively,
 * across workspaces, from the manifests whose workspace root is `lockRoot`.
 */
function findPathCrates(lockRoot: string, manifestDirs: string[], read: ReadManifest): Set<string> {
  const found = new Set<string>();
  const queue = manifestDirs.filter((dir) => findCargoWorkspaceRoot(dir, read) === lockRoot);
  for (let dir = queue.pop(); dir !== undefined; dir = queue.pop()) {
    if (found.has(dir)) {
      continue;
    }
    found.add(dir);
    const manifest = asTable(read(path.join(dir, 'Cargo.toml')));
    const root = findCargoWorkspaceRoot(dir, read);
    const inherited = asTable(asTable(asTable(read(path.join(root, 'Cargo.toml'))).workspace).dependencies);
    // Cargo resolves dev-dependencies for the lock's own workspace members only.
    const kinds = root === lockRoot ? DEPENDENCY_KINDS : DEPENDENCY_KINDS.filter((kind) => kind !== 'dev-dependencies');
    const tables = [manifest, ...Object.values(asTable(manifest.target)).map(asTable)].flatMap((scope) =>
      kinds.map((kind) => asTable(scope[kind])),
    );
    for (const table of [...tables, ...Object.values(asTable(manifest.patch)).map(asTable)]) {
      for (const [key, value] of Object.entries(table)) {
        const dependency = asTable(value);
        const [base, source] = dependency.workspace === true ? [root, asTable(inherited[key])] : [dir, dependency];
        if (typeof source.path === 'string') {
          queue.push(path.resolve(base, source.path));
        }
      }
    }
  }
  return found;
}

interface CargoLockEntry {
  name: string;
  version: string;
  start: number;
  /** Last non-blank line. */
  end: number;
  versionLine: number;
  /** Registry and git packages carry a `source`; path and workspace packages don't. */
  hasSource: boolean;
}

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

/** Semver precedence: the order cargo keeps same-name `[[package]]` entries in. */
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

/** Re-sort adjacent same-name entries by version, keeping blank lines in place; non-adjacent ones are left. */
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

/** Re-sort each run of `name` references; cargo orders them by version as a string (`10.0.0` before `2.0.0`). */
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
 * Set a path crate's version in Cargo.lock content the way cargo would: its `version` line and any
 * `"<name> <old version>"` references (cargo writes the version into a reference only when the lock
 * holds several versions of the name), re-sorting same-name entries if their order changes.
 *
 * Undefined when the lock has no path entry for the crate. Throws when the name is ambiguous: several
 * path entries, or another source's entry at the old or new version.
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

/** The slice of `@releasekit/git`'s `Git` this needs; core doesn't depend on that package. */
export interface CargoLockGit {
  isRepository(cwd?: string): Promise<boolean>;
  lsFiles(opts?: { paths?: string[]; cwd?: string }): Promise<string[]>;
  isIgnored(file: string, cwd?: string): Promise<boolean>;
}

export interface CargoLockBump {
  cargoTomlPath: string;
  name: string;
  version: string;
}

export interface CargoLockUpdate {
  lockPath: string;
  content: string;
  changed: boolean;
}

/**
 * Plan the content of every Cargo.lock that records a bumped crate, by text edit (no cargo, toolchain or
 * network). Candidates are every tracked lock plus each crate's own lock unless git ignores it.
 *
 * A crate's own lock always takes its bump. Names repeat across workspaces (every `tauri init` app is
 * `app`), so another lock takes it only if the lock's workspace reaches the crate's directory by path.
 *
 * Writes nothing; throws, naming the lock, when any lock can't be edited unambiguously.
 */
export async function planCargoLockUpdates(
  git: CargoLockGit,
  cwd: string,
  bumps: CargoLockBump[],
): Promise<CargoLockUpdate[]> {
  const lockPaths = new Set<string>();
  const manifestDirs: string[] = [];
  if (await git.isRepository(cwd)) {
    for (const file of await git.lsFiles({ paths: [':(top,glob)**/Cargo.lock', ':(top,glob)**/Cargo.toml'], cwd })) {
      if (path.basename(file) === 'Cargo.lock') {
        lockPaths.add(path.resolve(cwd, file));
      } else {
        manifestDirs.push(path.resolve(cwd, path.dirname(file)));
      }
    }
  }
  const owners = new Map<string, CargoLockBump[]>();
  for (const bump of bumps) {
    const ownLock = findCargoLockfile(path.dirname(bump.cargoTomlPath));
    if (ownLock && !(await git.isIgnored(ownLock, cwd))) {
      owners.set(ownLock, [...(owners.get(ownLock) ?? []), bump]);
      lockPaths.add(ownLock);
    }
  }
  const manifests = new Map<string, Table | undefined>();
  const read: ReadManifest = (cargoTomlPath) => {
    if (!manifests.has(cargoTomlPath)) {
      manifests.set(cargoTomlPath, readManifest(cargoTomlPath));
    }
    return manifests.get(cargoTomlPath);
  };

  const updates: CargoLockUpdate[] = [];
  for (const lockPath of lockPaths) {
    // Tracked but deleted in the work tree: nothing to sync.
    if (!fs.existsSync(lockPath)) {
      continue;
    }
    const original = fs.readFileSync(lockPath, 'utf8');
    let pathCrates: Set<string> | undefined;
    let content = original;
    let listed = false;
    for (const bump of bumps) {
      if (!owners.get(lockPath)?.includes(bump)) {
        pathCrates ??= findPathCrates(path.dirname(lockPath), manifestDirs, read);
        if (!pathCrates.has(path.resolve(path.dirname(bump.cargoTomlPath)))) {
          continue;
        }
      }
      let next: string | undefined;
      try {
        next = setCargoLockVersion(content, bump.name, bump.version);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`can't set ${bump.name} to ${bump.version} in ${lockPath}: ${detail}`);
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
