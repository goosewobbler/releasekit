import type { Package } from '@manypkg/get-packages';
import { createGitCli } from '@releasekit/git';
import semver from 'semver';
import type { Config, CurrentVersion, ReleasedAfter } from '../types.js';
import { formatTag, formatVersionPrefix } from '../utils/formatting.js';
import { writeVersionFile } from '../utils/jsonOutput.js';
import { log } from '../utils/logging.js';
import { getVersionFromManifests } from '../utils/manifestHelpers.js';
import { seedMissingEntries } from './seed.js';
import {
  parseVersionRecord,
  readVersionRecord,
  recordRelease,
  serializeVersionRecord,
  VERSION_RECORD_FILE,
  type VersionRecordEntries,
  versionRecordKey,
  versionRecordPath,
} from './versionRecord.js';

const INITIAL_VERSION = '0.1.0';

/** The tag a strategy gives `name`'s release at `version`: sync without per-package tags shares one. */
function releaseTag(name: string, version: string, config: Config): string {
  const packageName = config.sync && !config.packageSpecificTags ? null : name;
  return formatTag(version, formatVersionPrefix(config.versionPrefix), packageName, config.tagTemplate);
}

/** A version run's `releasekit.versions.json`: the file's entries if it exists, else none, saved when a run releases. */
export class VersionRecord {
  /** Entries whose path no longer holds a package, dropped when the record is next written. */
  private orphans: string[] = [];
  /** Under `mismatchStrategy: 'error'`, seeding's tag and manifest mismatches, raised when the package is versioned. */
  private mismatches: Record<string, Error> = {};
  /** Versions the remote base branch's record released at or after the run's commit, by entry key. */
  private releasedAfterRun = new Map<string, string>();

  private constructor(
    private readonly root: string,
    private readonly at: string | undefined,
    private entries: VersionRecordEntries,
  ) {}

  /** Reads and validates the file if there is one. `at` is the commit the run computes its release at. */
  static open(root: string, at: string): VersionRecord {
    return new VersionRecord(root, at, readVersionRecord(root));
  }

  /** A record with no entries that is never written, for a project with no commits to record. */
  static empty(root = process.cwd()): VersionRecord {
    return new VersionRecord(root, undefined, {});
  }

  /**
   * Moves each entry whose path no longer holds one of `discovered` to the one package with no entry and the same
   * name. Any other such entry is removed when the record is next written. Returns the names moved.
   */
  reconcile(discovered: Package[]): string[] {
    const byKey = new Map(discovered.map((pkg) => [versionRecordKey(this.root, pkg.dir), pkg]));
    const moved: string[] = [];
    for (const [key, entry] of Object.entries(this.entries)) {
      if (byKey.has(key)) {
        continue;
      }
      delete this.entries[key];
      const candidates = discovered.filter(
        (pkg) => pkg.packageJson.name === entry.name && !this.entries[versionRecordKey(this.root, pkg.dir)],
      );
      // Several packages with the name, say an npm package and a crate, leave it unclear which one moved.
      const target = candidates.length === 1 ? candidates[0] : undefined;
      if (target) {
        this.entries[versionRecordKey(this.root, target.dir)] = entry;
        moved.push(entry.name);
      } else {
        this.orphans.push(`${entry.name} (${key})`);
      }
    }
    return moved;
  }

  /** Fails when an entry's commit isn't in the history of `HEAD`, as in a shallow clone or a reverted record. */
  async assertAncestors(): Promise<void> {
    const git = createGitCli();
    const notAncestors: string[] = [];
    for (const [key, entry] of Object.entries(this.entries)) {
      const commits = [entry.at, ...(entry.lastStable ? [entry.lastStable.at] : [])];
      for (const commit of commits) {
        if (!(await git.isAncestor(commit, 'HEAD', this.root))) {
          notAncestors.push(`${entry.name} (${key}) at ${commit}`);
        }
      }
    }
    if (notAncestors.length > 0) {
      throw new Error(
        `${VERSION_RECORD_FILE} records releases at commits that aren't in the history of HEAD: ` +
          `${notAncestors.join(', ')}. Check out the branch the record belongs to, or correct the entries.`,
      );
    }
  }

  /** Seeds each package without an entry from its release tags, returning the names seeded and those that can't be. */
  async seed(
    packages: Package[],
    config: Config,
  ): Promise<{ seeded: string[]; unseeded: Array<{ name: string; reason: string }> }> {
    const { record, unseeded, mismatches } = await seedMissingEntries(this.entries, packages, config, this.root);
    this.mismatches = mismatches;
    const seeded = Object.keys(record)
      .filter((key) => !this.entries[key])
      .map((key) => record[key].name);
    this.entries = record;
    return { seeded, unseeded };
  }

  /**
   * Reads the record at the remote base branch's tip, which a re-run's checkout and its remote-tracking branch may be
   * behind, for the packages released at or after the run's commit.
   */
  async loadReleasedAfter({ commit, remote, branch }: ReleasedAfter, config: Config): Promise<void> {
    const git = createGitCli();
    const failure = (what: string, error: unknown) =>
      new Error(
        `Can't ${what} to check what it has already released: ${error instanceof Error ? error.message : error}`,
      );
    try {
      await git.fetch(remote, { ref: `refs/heads/${branch}`, cwd: this.root });
    } catch (error) {
      throw failure(`fetch ${branch}`, error);
    }
    const tip = (await git.log({ range: 'FETCH_HEAD', format: '%H', extraArgs: ['-1'], cwd: this.root })).trim();
    const content = await git.readFileAt(tip, VERSION_RECORD_FILE, this.root);
    const remoteEntries = content === null ? {} : parseVersionRecord(content);
    let remoteTags: Record<string, string> | undefined;
    for (const [key, entry] of Object.entries(remoteEntries)) {
      if (!(await git.isAncestor(commit, entry.at, this.root))) {
        continue;
      }
      // A release computed at the run's own commit lands its record with the first package's tag, before the rest
      // publish, so only a package whose tag reached the remote counts: a re-run retries the others.
      if (await git.isAncestor(entry.at, commit, this.root)) {
        try {
          remoteTags ??= await git.remoteTags(remote, this.root);
        } catch (error) {
          throw failure('list the remote tags', error);
        }
        if (!Object.hasOwn(remoteTags, releaseTag(entry.name, entry.version, config))) {
          continue;
        }
      }
      this.releasedAfterRun.set(key, entry.version);
    }
  }

  /** The package's entry, else `fallback`, else its first enabled ecosystem's manifest version, else 0.1.0. */
  current(pkg: Package, config: Config, fallback?: CurrentVersion): CurrentVersion {
    const key = versionRecordKey(this.root, pkg.dir);
    const mismatch = this.mismatches[key];
    if (mismatch) {
      throw mismatch;
    }
    const entry = this.entries[key];
    const releasedAfterRun = this.releasedAfterRun.get(key);
    if (entry) {
      return { version: entry.version, recorded: true, releasedAfterRun };
    }
    if (fallback) {
      return { version: fallback.version, recorded: fallback.recorded, releasedAfterRun };
    }
    const manifestVersion = semver.valid(getVersionFromManifests(pkg.dir, config).version);
    return { version: manifestVersion ?? INITIAL_VERSION, recorded: false, releasedAfterRun };
  }

  /**
   * A group's version: the highest of its members' entries, else the highest of their manifest versions, else 0.1.0.
   */
  groupCurrent(members: Package[], config: Config): CurrentVersion {
    const currents = members.map((pkg) => this.current(pkg, config));
    const recorded = currents.filter((current) => current.recorded);
    const candidates = recorded.length > 0 ? recorded : currents;
    const highest = candidates.reduce<CurrentVersion | undefined>(
      (max, current) => (!max || semver.gt(current.version, max.version) ? current : max),
      undefined,
    );
    if (!highest) {
      return { version: INITIAL_VERSION, recorded: false };
    }
    const releasedAfterRun = currents.find((current) => current.releasedAfterRun)?.releasedAfterRun;
    return { version: highest.version, recorded: recorded.length > 0, releasedAfterRun };
  }

  /**
   * Records each released package and writes the file, creating it if it doesn't exist yet. A run that released
   * nothing writes nothing, and a name that isn't a package, such as a monorepo's root manifest, gets no entry.
   */
  saveReleases(released: ReadonlyMap<string, string>, packages: Package[], dryRun: boolean): void {
    const at = this.at;
    if (!at) {
      return;
    }
    let changed = false;
    for (const [name, version] of released) {
      const pkg = packages.find((p) => p.packageJson.name === name);
      if (pkg) {
        const key = versionRecordKey(this.root, pkg.dir);
        this.entries[key] = recordRelease(this.entries[key], name, version, at);
        changed = true;
      }
    }
    if (changed) {
      for (const orphan of this.orphans) {
        log(`Removing ${orphan} from ${VERSION_RECORD_FILE}: its path no longer holds a package`, 'warning');
      }
      writeVersionFile(versionRecordPath(this.root), serializeVersionRecord(this.entries), dryRun);
    }
  }
}
