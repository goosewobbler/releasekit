import fs from 'node:fs';
import path from 'node:path';
import { type CargoManifest, isCratePublishable } from '@releasekit/config';
import { type CargoLockBump, findCargoPathDependencies, listCargoManifests } from '@releasekit/core';
import { createGitCli } from '@releasekit/git';
import semver from 'semver';
import * as TOML from 'smol-toml';
import { readPendingWrite, recordPendingWrite } from '../utils/jsonOutput.js';
import { log } from '../utils/logging.js';
import { recordedCargoBumps } from './cargoLock.js';

type Manifest = Record<string, unknown>;

/**
 * A crate publishes the requirement its source declares, so raise each internal dependent's requirement on a crate
 * this run released. A releasing dependent always gets the released version, so its published manifest requires the
 * release it was built with. Any other requirement, a dev-dependency's included, changes only when it rejects the new
 * version: Cargo checks a path dependency's local version against it, so every local build would fail. Raising a
 * dev-dependency regardless would turn a dev cycle between two releasing crates into one neither can publish first.
 *
 * Checks every tracked Cargo.toml: a crate that never releases (`publish = false`) can still depend on one that does.
 */
export async function raiseCargoDependentRequirements(cwd: string, dryRun: boolean): Promise<void> {
  const bumps = recordedCargoBumps();
  if (bumps.length === 0) {
    return;
  }
  raiseRequirementsIn(await listCargoManifests(createGitCli(), cwd), bumps, dryRun);
}

export function raiseRequirementsIn(manifestPaths: string[], bumps: readonly CargoLockBump[], dryRun: boolean): void {
  const releasedByDir = new Map(bumps.map((bump) => [path.dirname(path.resolve(bump.cargoTomlPath)), bump]));
  const releasing = new Set(bumps.map((bump) => path.resolve(bump.cargoTomlPath)));
  const manifests = new Map<string, Manifest | undefined>();
  const read = (manifestPath: string): Manifest | undefined => {
    if (!manifests.has(manifestPath)) {
      manifests.set(manifestPath, parseManifest(manifestPath));
    }
    return manifests.get(manifestPath);
  };

  const editable = new Set([...manifestPaths.map((p) => path.resolve(p)), ...releasing]);
  // A shared [workspace.dependencies] entry may already be raised by an earlier member.
  const originals = new WeakMap<object, string>();
  const changed = new Set<string>();
  for (const manifestPath of editable) {
    const isReleasing = releasing.has(manifestPath);
    const manifest = read(manifestPath) as CargoManifest | undefined;
    const crate = manifest?.package?.name ?? manifestPath;
    const publishes = manifest !== undefined && isCratePublishable(manifest);
    for (const { kind, manifestPath: declaredIn, entry, dir } of findCargoPathDependencies(manifestPath, read)) {
      const released = releasedByDir.get(dir);
      if (!released || typeof entry.version !== 'string') {
        continue;
      }
      const original = originals.get(entry) ?? entry.version;
      originals.set(entry, original);
      const isDev = kind === 'dev-dependencies';
      if ((!isReleasing || isDev) && cargoRequirementAccepts(original, released.version)) {
        continue;
      }
      const raised = raiseRequirement(entry.version, released.version);
      // A `package.workspace` pointer can lead outside the repository, to a file the release can't commit.
      if (raised !== entry.version && !editable.has(declaredIn)) {
        log(
          `Can't raise ${crate}'s requirement on ${released.name}: it's declared in ${declaredIn}, which git doesn't track`,
          'warning',
        );
      } else if (raised !== entry.version) {
        const where = declaredIn === manifestPath ? '' : ` in ${declaredIn}'s [workspace.dependencies]`;
        log(
          `${dryRun ? '[DRY RUN] Would raise' : 'Raised'} ${crate}'s requirement on ${released.name}${where} from "${entry.version}" to "${raised}"`,
          'info',
        );
        entry.version = raised;
        changed.add(declaredIn);
      }
      if (!isReleasing && !isDev && publishes) {
        log(
          `${crate} isn't releasing, so its published version keeps requiring ${released.name} "${original}" until it does`,
          'warning',
        );
      }
    }
  }

  for (const manifestPath of changed) {
    const updated = TOML.stringify(read(manifestPath) as Manifest);
    if (dryRun) {
      recordPendingWrite(manifestPath, updated);
    } else {
      fs.writeFileSync(manifestPath, updated);
    }
  }
}

function parseManifest(manifestPath: string): Manifest | undefined {
  const pending = readPendingWrite(manifestPath);
  if (pending === undefined && !fs.existsSync(manifestPath)) {
    return undefined;
  }
  try {
    return TOML.parse(pending ?? fs.readFileSync(manifestPath, 'utf-8'));
  } catch (error) {
    log(
      `Couldn't check ${manifestPath} for requirements on released crates: ${error instanceof Error ? error.message : String(error)}`,
      'warning',
    );
    return undefined;
  }
}

/**
 * Cargo reads a bare version as a caret requirement and ANDs comma-separated comparators; npm's semver doesn't.
 * A wildcard (`1.2.*`) means the same to both.
 */
export function cargoRequirementAccepts(requirement: string, version: string): boolean {
  const range = requirement
    .split(',')
    .map((comparator) => comparator.trim())
    .map((comparator) => (/^\d+(\.\d+){0,2}([-+]|$)/.test(comparator) ? `^${comparator}` : comparator))
    .join(' ');
  return semver.satisfies(version, range);
}

/** Keeps a single comparator's operator; anything else becomes a plain (caret) requirement. */
export function raiseRequirement(requirement: string, version: string): string {
  const operator = /^\s*([~^=]?)\s*\d[\w.+-]*\s*$/.exec(requirement)?.[1];
  return operator === undefined ? version : `${operator}${version}`;
}
