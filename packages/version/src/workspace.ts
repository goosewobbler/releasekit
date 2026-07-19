import { loadConfig } from './config.js';
import { VersionEngine } from './core/versionEngine.js';

/**
 * Resolve the names of every package in the workspace (npm + cargo + pub), independent of whether
 * each earned a releasable change this run. The standing-PR selection layer needs this to resolve
 * `ci.standingPr.primaryPackages` patterns — including a primary that isn't bumping, which never
 * appears in `VersionOutput.updates[]` yet must still anchor its release unit (#464).
 */
export async function getWorkspacePackageNames(options: { cwd?: string; configPath?: string } = {}): Promise<string[]> {
  const config = loadConfig({ cwd: options.cwd, configPath: options.configPath });
  const engine = new VersionEngine(config, { dryRun: true });
  // Discover packages from the SAME root the config was loaded from — otherwise discovery would fall
  // back to process.cwd() and could match primaries against a different workspace than configured.
  const { packages } = await engine.getWorkspacePackages(options.cwd);
  return packages.map((p) => p.packageJson.name).filter((name): name is string => Boolean(name));
}

/**
 * The current on-disk version of every workspace package (npm + cargo + pub), keyed by package name.
 * Reads each package's manifest as it stands in the checkout — the ground truth of what a publish will
 * ship. The standing-PR publish path compares this against the release manifest's claimed versions to
 * refuse a forged manifest whose versions/packages don't match the merged source (#556).
 */
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
    if (name && version) versions[name] = version;
  }
  return versions;
}
