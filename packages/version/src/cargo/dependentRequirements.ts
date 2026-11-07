import fs from 'node:fs';
import path from 'node:path';
import type { CargoLockBump } from '@releasekit/core';
import semver from 'semver';
import * as TOML from 'smol-toml';
import { readPendingWrite, recordPendingWrite } from '../utils/jsonOutput.js';
import { log } from '../utils/logging.js';

const DEPENDENCY_TABLES = ['dependencies', 'dev-dependencies', 'build-dependencies'];

/**
 * A crate publishes the requirement its source declares, so raise each internal dependent's requirement on a crate
 * this run released. A releasing dependent always gets the released version, so its published manifest requires the
 * release it was built with. Any other dependent changes only when its requirement rejects the new version: Cargo
 * checks a path dependency's local version against it, so every local build would fail.
 */
export function raiseCargoDependentRequirements(
  manifestPaths: string[],
  bumps: readonly CargoLockBump[],
  dryRun: boolean,
): void {
  const releasedByDir = new Map(bumps.map((bump) => [path.dirname(path.resolve(bump.cargoTomlPath)), bump]));
  const releasing = new Set(bumps.map((bump) => path.resolve(bump.cargoTomlPath)));
  for (const manifestPath of new Set([...manifestPaths.map((p) => path.resolve(p)), ...releasing])) {
    raiseIn(manifestPath, releasedByDir, releasing.has(manifestPath), dryRun);
  }
}

function raiseIn(
  manifestPath: string,
  releasedByDir: Map<string, CargoLockBump>,
  isReleasing: boolean,
  dryRun: boolean,
): void {
  let manifest: Record<string, unknown>;
  try {
    manifest = TOML.parse(readPendingWrite(manifestPath) ?? fs.readFileSync(manifestPath, 'utf-8'));
  } catch (error) {
    log(
      `Couldn't check ${manifestPath} for requirements on released crates: ${error instanceof Error ? error.message : String(error)}`,
      'warning',
    );
    return;
  }
  const crate =
    isRecord(manifest.package) && typeof manifest.package.name === 'string' ? manifest.package.name : manifestPath;

  let changed = false;
  for (const table of dependencyTables(manifest)) {
    for (const dep of Object.values(table)) {
      if (!isRecord(dep) || typeof dep.path !== 'string' || typeof dep.version !== 'string') {
        continue;
      }
      const released = releasedByDir.get(path.resolve(path.dirname(manifestPath), dep.path));
      if (!released || (!isReleasing && cargoRequirementAccepts(dep.version, released.version))) {
        continue;
      }
      const raised = raiseRequirement(dep.version, released.version);
      if (raised === dep.version) {
        continue;
      }
      log(
        `${dryRun ? '[DRY RUN] Would raise' : 'Raised'} ${crate}'s requirement on ${released.name} from "${dep.version}" to "${raised}"`,
        'info',
      );
      if (!isReleasing) {
        log(
          `${crate} isn't releasing, so its published version keeps requiring ${released.name} "${dep.version}" until it does`,
          'warning',
        );
      }
      dep.version = raised;
      changed = true;
    }
  }
  if (!changed) {
    return;
  }

  const updated = TOML.stringify(manifest);
  if (dryRun) {
    recordPendingWrite(manifestPath, updated);
  } else {
    fs.writeFileSync(manifestPath, updated);
  }
}

/** Top-level and `[target.<cfg>.*]` dependency tables. */
function dependencyTables(manifest: Record<string, unknown>): Record<string, unknown>[] {
  const scopes = [manifest, ...Object.values(isRecord(manifest.target) ? manifest.target : {})];
  return scopes.filter(isRecord).flatMap((scope) => DEPENDENCY_TABLES.map((name) => scope[name]).filter(isRecord));
}

/** Cargo reads a bare version as a caret requirement and ANDs comma-separated comparators; npm's semver doesn't. */
export function cargoRequirementAccepts(requirement: string, version: string): boolean {
  const range = requirement
    .split(',')
    .map((comparator) => comparator.trim())
    .map((comparator) => (/^\d/.test(comparator) ? `^${comparator}` : comparator))
    .join(' ');
  return semver.satisfies(version, range);
}

/** Keeps a single comparator's operator; anything else becomes a plain (caret) requirement. */
export function raiseRequirement(requirement: string, version: string): string {
  const operator = /^\s*([~^=]?)\s*\d[\w.+-]*\s*$/.exec(requirement)?.[1];
  return operator === undefined ? version : `${operator}${version}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
