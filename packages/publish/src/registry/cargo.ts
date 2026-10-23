import * as fs from 'node:fs';
import * as path from 'node:path';
import { isCratePublishable } from '@releasekit/config';
import { buildDependencyGraph, debug, type GraphPackage, type VersionPackageUpdate } from '@releasekit/core';
import { createGitCli } from '@releasekit/git';
import { createPublishError, PublishErrorCode } from '../errors/index.js';
import type { PipelineContext } from '../types.js';
import { hasCargoAuth } from '../utils/auth.js';
import { CRATES_IO_API_TIMEOUT_MS, CRATES_IO_USER_AGENT, extractPathDeps, parseCargoToml } from '../utils/cargo.js';
import { execCommand } from '../utils/exec.js';
import type { Registry, RegistryTarget } from './types.js';

const ALREADY_PUBLISHED_PATTERN = /already exists on crates\.io index|already uploaded/i;

interface CargoTarget extends RegistryTarget {
  dir: string;
  manifestPath: string;
  pathDeps: string[];
}

/** Repository-level dirty state, resolved once per run and reused for every crate's `--allow-dirty`. */
interface CargoSession {
  isDirty: boolean;
}

async function isCratePublished(name: string, version: string): Promise<boolean> {
  try {
    const response = await fetch(`https://crates.io/api/v1/crates/${name}/${version}`, {
      signal: AbortSignal.timeout(CRATES_IO_API_TIMEOUT_MS),
      headers: { 'User-Agent': CRATES_IO_USER_AGENT },
    });
    if (response.status === 200) {
      return true;
    }
    if (response.status === 404) {
      return false;
    }
    debug(`crates.io published-check returned ${response.status} for ${name}@${version}, will attempt publish`);
    return false;
  } catch (error) {
    debug(
      `crates.io published-check failed for ${name}@${version} (${error instanceof Error ? error.message : String(error)}), will attempt publish`,
    );
    return false;
  }
}

async function isGitWorkingDirDirty(cwd: string): Promise<boolean> {
  try {
    const status = await createGitCli().status({ porcelain: true, cwd });
    return status.trim().length > 0;
  } catch {
    return false;
  }
}

export const cargoRegistry: Registry<CargoTarget, CargoSession> = {
  id: 'cargo',
  displayName: 'crates.io',
  alreadyPublishedNote: ' on crates.io',
  disabledLog: { level: 'debug', message: 'Cargo publishing disabled in config' },
  publishErrorCode: PublishErrorCode.CARGO_PUBLISH_ERROR,
  alreadyPublishedPattern: ALREADY_PUBLISHED_PATTERN,

  isEnabled: (config) => config.cargo.enabled,

  async authCheck(ctx: PipelineContext): Promise<CargoSession> {
    if (!hasCargoAuth() && !ctx.cliOptions.dryRun) {
      throw createPublishError(PublishErrorCode.CARGO_AUTH_ERROR, 'CARGO_REGISTRY_TOKEN not set');
    }
    return { isDirty: false };
  },

  async discover(ctx: PipelineContext): Promise<CargoTarget[]> {
    const crates = findCrates(
      ctx.input.updates.map((u) => ({ dir: path.dirname(path.resolve(ctx.cwd, u.filePath)), ...u })),
    );
    return orderCrates(crates, ctx.config.cargo.publishOrder);
  },

  async prepare(ctx: PipelineContext, session: CargoSession): Promise<void> {
    session.isDirty = await isGitWorkingDirDirty(ctx.cwd);
  },

  isPublished: (target) => isCratePublished(target.packageName, target.version),

  async prePublish(target: CargoTarget, ctx: PipelineContext): Promise<void> {
    if (ctx.config.cargo.clean) {
      await execCommand('cargo', ['clean'], {
        cwd: target.dir,
        dryRun: ctx.cliOptions.dryRun,
        label: `cargo clean (${target.packageName})`,
      });
    }
  },

  async publish(target: CargoTarget, ctx: PipelineContext, session: CargoSession): Promise<void> {
    const publishArgs = ['publish', '--manifest-path', target.manifestPath];
    if (ctx.config.cargo.noVerify) {
      publishArgs.push('--no-verify');
    }
    if (session.isDirty) {
      publishArgs.push('--allow-dirty');
    }

    await execCommand('cargo', publishArgs, {
      cwd: ctx.cwd,
      dryRun: ctx.cliOptions.dryRun,
      label: `cargo publish ${target.packageName}@${target.version}`,
      timeout: 30 * 60 * 1000,
    });
  },
};

function findCrates(
  updates: Array<{ packageName: string; newVersion: string; filePath: string; dir: string }>,
): CargoTarget[] {
  const crates: CargoTarget[] = [];

  for (const update of updates) {
    const cargoPath = path.join(update.dir, 'Cargo.toml');
    if (!fs.existsSync(cargoPath)) {
      continue;
    }

    try {
      const cargo = parseCargoToml(cargoPath);

      if (!cargo.package?.name) {
        continue;
      }
      if (!isCratePublishable(cargo)) {
        debug(`Skipping crate ${cargo.package.name}: publish = false`);
        continue;
      }

      crates.push({
        packageName: cargo.package.name,
        updatePackageName: update.packageName,
        version: update.newVersion,
        dir: update.dir,
        manifestPath: cargoPath,
        pathDeps: extractPathDeps(cargo),
      });
    } catch {
      // Skip unparseable Cargo.toml
    }
  }

  return crates;
}

export function orderCargoVersionUpdates(
  updates: VersionPackageUpdate[],
  explicitOrder: string[],
  cwd: string,
): VersionPackageUpdate[] {
  const withDir = updates.map((u) => ({
    ...u,
    dir: path.dirname(path.resolve(cwd, u.filePath)),
  }));
  const crates = findCrates(withDir);
  if (crates.length <= 1) {
    return updates;
  }
  const orderedCrates = orderCrates(crates, explicitOrder);
  // Match by directory, not package name: a crate and a pub package can share a name.
  const byDir = new Map(updates.map((u) => [path.dirname(path.resolve(cwd, u.filePath)), u]));
  const cargoDirs = new Set(crates.map((c) => path.resolve(c.dir)));
  const ordered = orderedCrates
    .map((c) => byDir.get(path.resolve(c.dir)))
    .filter((u): u is VersionPackageUpdate => u !== undefined);
  for (const u of updates) {
    if (!cargoDirs.has(path.dirname(path.resolve(cwd, u.filePath)))) {
      ordered.push(u);
    }
  }
  return ordered;
}

/** Directories whose update is a publishable crate. Hybrids use a package.json path in that directory. */
export function cargoUpdateDirs(updates: VersionPackageUpdate[], cwd: string): Set<string> {
  const withDir = updates.map((u) => ({
    ...u,
    dir: path.dirname(path.resolve(cwd, u.filePath)),
  }));
  return new Set(findCrates(withDir).map((c) => path.resolve(c.dir)));
}

function orderCrates(crates: CargoTarget[], explicitOrder: string[]): CargoTarget[] {
  if (explicitOrder.length > 0) {
    const ordered: CargoTarget[] = [];
    const byName = new Map(crates.map((c) => [c.packageName, c]));

    for (const name of explicitOrder) {
      const crate = byName.get(name);
      if (crate) {
        ordered.push(crate);
        byName.delete(name);
      }
    }

    for (const crate of byName.values()) {
      ordered.push(crate);
    }

    return ordered;
  }

  return topologicalSort(crates);
}

function topologicalSort(crates: CargoTarget[]): CargoTarget[] {
  const byName = new Map(crates.map((c) => [c.packageName, c]));
  // `path` deps are directories, so map each crate's directory back to its name.
  const nameByDir = new Map(crates.map((c) => [path.resolve(c.dir), c.packageName]));

  const graphPackages: GraphPackage[] = crates.map((c) => ({
    name: c.packageName,
    dir: c.dir,
    ecosystem: 'cargo',
    deps: c.pathDeps
      .map((depPath) => nameByDir.get(path.resolve(c.dir, depPath)))
      .filter((name): name is string => name !== undefined),
  }));

  const graph = buildDependencyGraph(graphPackages);
  return graph
    .topologicalOrder(crates.map((c) => c.packageName))
    .map((name) => byName.get(name))
    .filter((crate): crate is CargoTarget => crate !== undefined);
}
