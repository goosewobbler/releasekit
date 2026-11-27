import type { WorkspaceDependencyGraph } from '@releasekit/core';
import { loadConfig } from './config.js';
import { VersionEngine } from './core/versionEngine.js';
import { buildWorkspaceGraph } from './core/workspaceGraph.js';

/**
 * Every package discovery finds (npm, cargo & pub), whether or not it changed; `version.packages`, the private filter
 * and a disabled `cargo` or `pub` still apply. Standing-PR selection resolves `version.primaryPackages` against
 * it: a non-bumping primary never appears in `VersionOutput.updates[]` yet must still anchor its release unit.
 */
export async function getWorkspacePackageNames(options: { cwd?: string; configPath?: string } = {}): Promise<string[]> {
  const config = loadConfig({ cwd: options.cwd, configPath: options.configPath });
  const engine = new VersionEngine(config, { dryRun: true });
  // Same root the config was loaded from - otherwise discovery falls back to process.cwd() and could
  // match primaries against a different workspace than configured.
  const { packages } = await engine.getWorkspacePackages(options.cwd);
  return packages.map((p) => p.packageJson.name).filter((name): name is string => Boolean(name));
}

/** Directory of each named package `getWorkspacePackageNames` returns, keyed by name. */
export async function getWorkspacePackageDirs(
  options: { cwd?: string; configPath?: string } = {},
): Promise<Record<string, string>> {
  const config = loadConfig({ cwd: options.cwd, configPath: options.configPath });
  const engine = new VersionEngine(config, { dryRun: true });
  const { packages } = await engine.getWorkspacePackages(options.cwd);
  const dirs: Record<string, string> = {};
  for (const p of packages) {
    if (p.packageJson.name) {
      dirs[p.packageJson.name] = p.dir;
    }
  }
  return dirs;
}

/** Version of each package `getWorkspacePackageNames` returns that has one, keyed by name. */
export async function getWorkspacePackageVersions(
  options: { cwd?: string; configPath?: string } = {},
): Promise<Record<string, string>> {
  const config = loadConfig({ cwd: options.cwd, configPath: options.configPath });
  const engine = new VersionEngine(config, { dryRun: true });
  const { packages } = await engine.getWorkspacePackages(options.cwd);
  const versions: Record<string, string> = {};
  for (const p of packages) {
    const name = p.packageJson.name;
    const version = p.packageJson.version;
    if (name && version) {
      versions[name] = version;
    }
  }
  return versions;
}

/** Internal dependency graph of the packages `getWorkspacePackageNames` returns. */
export async function getWorkspaceDependencyGraph(
  options: { cwd?: string; configPath?: string } = {},
): Promise<WorkspaceDependencyGraph> {
  const config = loadConfig({ cwd: options.cwd, configPath: options.configPath });
  const engine = new VersionEngine(config, { dryRun: true });
  const { packages } = await engine.getWorkspacePackages(options.cwd);
  return buildWorkspaceGraph(packages);
}
