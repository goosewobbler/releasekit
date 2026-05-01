import * as fs from 'node:fs';
import * as path from 'node:path';
import { debug, success, warn } from '@releasekit/core';
import { createPublishError, PublishErrorCode } from '../errors/index.js';
import type { PipelineContext, PublishResult } from '../types.js';
import { hasCargoAuth } from '../utils/auth.js';
import { CRATES_IO_API_TIMEOUT_MS, CRATES_IO_USER_AGENT, extractPathDeps, parseCargoToml } from '../utils/cargo.js';
import { execCommand, execCommandSafe } from '../utils/exec.js';

async function isCratePublished(name: string, version: string): Promise<boolean> {
  try {
    const response = await fetch(`https://crates.io/api/v1/crates/${name}/${version}`, {
      signal: AbortSignal.timeout(CRATES_IO_API_TIMEOUT_MS),
      headers: { 'User-Agent': CRATES_IO_USER_AGENT },
    });
    if (response.status === 200) return true;
    if (response.status === 404) return false;
    debug(`crates.io published-check returned ${response.status} for ${name}@${version}, will attempt publish`);
    return false;
  } catch (error) {
    debug(
      `crates.io published-check failed for ${name}@${version} (${error instanceof Error ? error.message : String(error)}), will attempt publish`,
    );
    return false;
  }
}

// Check if git working directory has uncommitted changes
async function isGitWorkingDirDirty(cwd: string): Promise<boolean> {
  try {
    const result = await execCommandSafe('git', ['status', '--porcelain'], { cwd, dryRun: false });
    return result.exitCode === 0 && result.stdout.trim().length > 0;
  } catch {
    return false;
  }
}

/** Error strategy: FAIL-FAST. First publish failure aborts the stage. */
export async function runCargoPublishStage(ctx: PipelineContext): Promise<void> {
  const { input, config, cliOptions, cwd } = ctx;
  const dryRun = cliOptions.dryRun;

  if (!config.cargo.enabled) {
    debug('Cargo publishing disabled in config');
    return;
  }

  if (!hasCargoAuth() && !dryRun) {
    throw createPublishError(PublishErrorCode.CARGO_AUTH_ERROR, 'CARGO_REGISTRY_TOKEN not set');
  }

  // Find crates to publish
  const crates = findCrates(
    input.updates.map((u) => ({ dir: path.dirname(path.resolve(cwd, u.filePath)), ...u })),
    cwd,
  );

  if (crates.length === 0) {
    debug('No Cargo crates found to publish');
    return;
  }

  // Determine publish order
  const ordered = orderCrates(crates, config.cargo.publishOrder);

  // Check if working directory is dirty (repository-level property, not crate-specific)
  const isDirty = await isGitWorkingDirDirty(cwd);

  for (const crate of ordered) {
    const result: PublishResult = {
      packageName: crate.name,
      version: crate.version,
      registry: 'cargo',
      success: false,
      skipped: false,
    };

    // Check if already published via the crates.io API (avoids `cargo search`,
    // which has no timeout and can stall on a fresh registry index sync).
    if (await isCratePublished(crate.name, crate.version)) {
      result.alreadyPublished = true;
      result.skipped = true;
      result.success = true;
      result.reason = 'Already published on crates.io';
      ctx.output.cargo.push(result);
      warn(`${crate.name}@${crate.version} is already published on crates.io, skipping`);
      continue;
    }

    // Optional cargo clean
    if (config.cargo.clean) {
      await execCommand('cargo', ['clean'], { cwd: crate.dir, dryRun, label: `cargo clean (${crate.name})` });
    }

    // Publish
    const publishArgs = ['publish', '--manifest-path', crate.manifestPath];
    if (config.cargo.noVerify) {
      publishArgs.push('--no-verify');
    }
    if (isDirty) {
      publishArgs.push('--allow-dirty');
    }

    try {
      await execCommand('cargo', publishArgs, {
        cwd,
        dryRun,
        label: `cargo publish ${crate.name}@${crate.version}`,
        timeout: 30 * 60 * 1000, // 30 minutes timeout
      });
      result.success = true;
      if (!dryRun) {
        success(`Published ${crate.name}@${crate.version} to crates.io`);
      }
      ctx.output.cargo.push(result);
    } catch (error) {
      result.reason = error instanceof Error ? error.message : String(error);
      ctx.output.cargo.push(result);
      throw createPublishError(
        PublishErrorCode.CARGO_PUBLISH_ERROR,
        `${crate.name}@${crate.version}: ${result.reason}`,
      );
    }
  }
}

interface CrateInfo {
  name: string;
  version: string;
  dir: string;
  manifestPath: string;
  pathDeps: string[];
}

function findCrates(
  updates: Array<{ packageName: string; newVersion: string; filePath: string; dir: string }>,
  _cwd: string,
): CrateInfo[] {
  const crates: CrateInfo[] = [];

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

      const pathDeps = extractPathDeps(cargo);

      crates.push({
        name: cargo.package.name,
        version: update.newVersion,
        dir: update.dir,
        manifestPath: cargoPath,
        pathDeps,
      });
    } catch {
      // Skip unparseable Cargo.toml
    }
  }

  return crates;
}

function orderCrates(crates: CrateInfo[], explicitOrder: string[]): CrateInfo[] {
  if (explicitOrder.length > 0) {
    const ordered: CrateInfo[] = [];
    const byName = new Map(crates.map((c) => [c.name, c]));

    for (const name of explicitOrder) {
      const crate = byName.get(name);
      if (crate) {
        ordered.push(crate);
        byName.delete(name);
      }
    }

    // Append remaining crates not in explicit order
    for (const crate of byName.values()) {
      ordered.push(crate);
    }

    return ordered;
  }

  // Auto-detect order via topological sort based on path dependencies
  return topologicalSort(crates);
}

function topologicalSort(crates: CrateInfo[]): CrateInfo[] {
  const nameSet = new Set(crates.map((c) => c.name));
  const graph = new Map<string, string[]>();
  const crateMap = new Map(crates.map((c) => [c.name, c]));

  for (const crate of crates) {
    graph.set(crate.name, []);
  }

  // Build dependency edges from path deps
  for (const crate of crates) {
    for (const depPath of crate.pathDeps) {
      const resolvedDir = path.resolve(crate.dir, depPath);
      // Find which crate lives at that path
      for (const other of crates) {
        if (path.resolve(other.dir) === resolvedDir && nameSet.has(other.name)) {
          graph.get(crate.name)?.push(other.name);
        }
      }
    }
  }

  // Kahn's algorithm
  const inDegree = new Map<string, number>();
  for (const name of nameSet) {
    inDegree.set(name, 0);
  }
  for (const deps of graph.values()) {
    for (const dep of deps) {
      inDegree.set(dep, (inDegree.get(dep) ?? 0) + 1);
    }
  }

  const queue: string[] = [];
  for (const [name, degree] of inDegree) {
    if (degree === 0) {
      queue.push(name);
    }
  }

  const result: CrateInfo[] = [];
  while (queue.length > 0) {
    const name = queue.shift();
    if (!name) break;
    const crate = crateMap.get(name);
    if (crate) {
      result.push(crate);
    }

    for (const dep of graph.get(name) ?? []) {
      const newDegree = (inDegree.get(dep) ?? 1) - 1;
      inDegree.set(dep, newDegree);
      if (newDegree === 0) {
        queue.push(dep);
      }
    }
  }

  // Reverse so dependencies come first
  result.reverse();

  return result;
}
