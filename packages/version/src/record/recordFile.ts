import type { Package } from '@manypkg/get-packages';
import type { Config } from '../types.js';
import { writeVersionFile } from '../utils/jsonOutput.js';
import { seedMissingEntries } from './seed.js';
import {
  readVersionRecord,
  recordRelease,
  serializeVersionRecord,
  type VersionRecordEntries,
  versionRecordKey,
  versionRecordPath,
} from './versionRecord.js';

/** A version run's `releasekit.versions.json`: the file's entries if it exists, else none, saved when a run releases. */
export class VersionRecord {
  private constructor(
    private readonly root: string,
    private readonly at: string,
    private entries: VersionRecordEntries,
  ) {}

  /** Reads and validates the file if there is one. `at` is the commit the run computes its release at. */
  static open(root: string, at: string): VersionRecord {
    return new VersionRecord(root, at, readVersionRecord(root));
  }

  /** Seeds each package without an entry from its release tags, returning the names seeded and those that can't be. */
  async seed(
    packages: Package[],
    config: Config,
  ): Promise<{ seeded: string[]; unseeded: Array<{ name: string; reason: string }> }> {
    const { record, unseeded } = await seedMissingEntries(this.entries, packages, config, this.root);
    const seeded = Object.keys(record)
      .filter((key) => !this.entries[key])
      .map((key) => record[key].name);
    this.entries = record;
    return { seeded, unseeded };
  }

  /**
   * Records each released package and writes the file, creating it if it doesn't exist yet. A run that released
   * nothing writes nothing, and a name that isn't a package, such as a monorepo's root manifest, gets no entry.
   */
  saveReleases(released: ReadonlyMap<string, string>, packages: Package[], dryRun: boolean): void {
    let changed = false;
    for (const [name, version] of released) {
      const pkg = packages.find((p) => p.packageJson.name === name);
      if (pkg) {
        const key = versionRecordKey(this.root, pkg.dir);
        this.entries[key] = recordRelease(this.entries[key], name, version, this.at);
        changed = true;
      }
    }
    if (changed) {
      writeVersionFile(versionRecordPath(this.root), serializeVersionRecord(this.entries), dryRun);
    }
  }
}
