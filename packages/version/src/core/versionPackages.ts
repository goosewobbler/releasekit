import fs from 'node:fs';
import * as path from 'node:path';
import type { Package } from '@manypkg/get-packages';
import type { VersionChangelogEntry } from '@releasekit/core';
import { shouldMatchPackageTargets, shouldProcessPackage } from '@releasekit/core';
import semver from 'semver';
import { extractChangelogEntriesFromCommits, extractRepoLevelChangelogEntries } from '../changelog/commitParser.js';
import { StrictReachableError } from '../errors/strictReachableError.js';
import { checkUnreachableTags, getLatestTag, getLatestTagForPackage } from '../git/tagsAndBranches.js';
import { updatePackageVersion } from '../package/packageManagement.js';
import type { VersionRecord } from '../record/recordFile.js';
import type { Config, CurrentVersion } from '../types.js';
import { formatReleaseCommitMessage, type ReleasedPackage } from '../utils/commitMessage.js';
import { resolveCommitScope } from '../utils/commitScope.js';
import { deriveBaselineTagPrefix, formatTag, formatVersionPrefix } from '../utils/formatting.js';
import {
  addBaselineTag,
  addChangelogData,
  addTag,
  setAllPackageUpdateActions,
  setAllPackageUpdatePreviousVersions,
  setCommitMessage,
  setPackageUpdateAction,
  setPackageUpdateGroup,
  setPackageUpdatePreviousVersion,
  setPackageUpdateTag,
  setSharedEntries,
  setVersioningStrategy,
} from '../utils/jsonOutput.js';
import { log } from '../utils/logging.js';
import { checkManifestToBump, hasManifestToBump, updateNativeManifests } from '../utils/manifestUpdates.js';
import { resolveVersionAction } from '../utils/versionAction.js';
import { BaselineResolver } from './baselineResolver.js';
import {
  expandTargetsForAtomicGroups,
  hasExplicitGroups,
  type ResolvedGroup,
  resolveGroups,
} from './groupResolution.js';
import { computeGroup, type PackagePlan } from './groupVersion.js';
import { calculateVersion } from './versionCalculator.js';
import type { PackagesWithRoot } from './versionEngine.js';

type ChangelogEntry = VersionChangelogEntry;

/** The version output's `strategy`, per ADR 0009. */
export type StrategyLabel = 'sync' | 'group' | 'async';

export function strategyLabel(config: Pick<Config, 'sync' | 'groups'>): StrategyLabel {
  if (config.sync) {
    return 'sync';
  }
  return hasExplicitGroups(config) ? 'group' : 'async';
}

/** Where project-wide entries come from. Only async releases record them (groups: https://github.com/goosewobbler/releasekit/issues/1004). */
interface SharedEntryScopes {
  workspaceRoot: string;
  packageOwnedDirs: string[];
  sharedPackageDirs: string[];
  entries: Map<string, ChangelogEntry>;
}

interface RunContext {
  config: Config;
  record: VersionRecord;
  repoRoot: string;
  formattedPrefix: string;
  /** The repo's latest release tag with each prefix, for a package without a tag of its own. */
  globalTags: Map<string | undefined, Promise<string>>;
  /** Group mode bumps only a package's own manifests, so it ignores `cargo.paths` and `pub.paths`. */
  ignorePaths: boolean;
  resolver: BaselineResolver;
  shared?: SharedEntryScopes;
}

const DEFAULT_COMMIT_MESSAGE = 'chore: release';
// biome-ignore lint/suspicious/noTemplateCurlyInString: a commit-message template, filled in by formatReleaseCommitMessage
const SYNC_COMMIT_MESSAGE = 'chore: release ${packageName} v${version}';

/**
 * Versions the run's packages. Each group releases together; every other package releases on its own. `sync: true` is
 * one fixed group of every package, released with one changelog, a shared tag and the root manifests bumped.
 */
export async function versionPackages(
  config: Config,
  packages: PackagesWithRoot,
  record: VersionRecord,
  targets: string[] = [],
  discovered: Package[] = packages.packages,
): Promise<void> {
  const label = strategyLabel(config);
  setVersioningStrategy(label);
  log(`Versioning ${packages.packages.length} package(s) as ${label}`, 'info');

  const ctx = await createContext(config, packages, record, label);
  const resolution = resolveGroups(config, packages.packages);
  // Discovery already applied the targets in sync mode.
  const expanded = label === 'sync' ? [] : expandTargetsForAtomicGroups(resolution, targets).targets;
  const targeted = (pkg: Package): boolean =>
    expanded.length === 0 || shouldMatchPackageTargets(pkg.packageJson.name, expanded);

  const released: ReleasedPackage[] = [];
  let sharedVersion: string | undefined;
  for (const group of resolution.groups) {
    if (group.implicit) {
      const result = await releaseSyncGroup(ctx, packages, discovered);
      if (result) {
        released.push(...result.released);
        sharedVersion = result.version;
      }
      continue;
    }
    released.push(...(await versionGroup(ctx, group, targeted)));
  }
  for (const pkg of resolution.ungrouped) {
    if (!targeted(pkg) || !shouldProcess(pkg, config)) {
      continue;
    }
    const result = await releasePackage(ctx, pkg);
    if (result) {
      released.push(result);
    }
  }

  if (ctx.shared) {
    setSharedEntries([...ctx.shared.entries.values()]);
  }

  if (released.length === 0 && !sharedVersion) {
    log('No packages required a version update.', 'info');
    return;
  }
  const template = config.commitMessage || (label === 'sync' ? SYNC_COMMIT_MESSAGE : DEFAULT_COMMIT_MESSAGE);
  setCommitMessage(
    formatReleaseCommitMessage(template, released, { versionPrefix: config.versionPrefix, version: sharedVersion }),
  );
  log(`Prepared ${released.length} package(s): ${released.map((p) => `${p.name}@${p.version}`).join(', ')}`, 'success');
}

async function createContext(
  config: Config,
  packages: PackagesWithRoot,
  record: VersionRecord,
  label: StrategyLabel,
): Promise<RunContext> {
  const repoRoot = packages.root ?? process.cwd();
  const formattedPrefix = formatVersionPrefix(config.versionPrefix);
  const resolver = new BaselineResolver({
    versionPrefix: formattedPrefix,
    tagTemplate: config.tagTemplate,
    packageSpecificTags: config.packageSpecificTags ?? false,
    strictReachable: config.strictReachable ?? false,
    baseRef: config.baseRef,
    sharedFloorCwd: process.cwd(),
    sharedChangelogFloor: config.sharedChangelogFloor,
  });
  return {
    config,
    record,
    repoRoot,
    formattedPrefix,
    globalTags: new Map(),
    ignorePaths: label === 'group',
    resolver,
    ...(label === 'async' ? { shared: sharedEntryScopes(config, packages.packages, repoRoot) } : {}),
  };
}

function sharedEntryScopes(config: Config, packages: Package[], repoRoot: string): SharedEntryScopes {
  // The full workspace, so a commit touching only a non-releasing package isn't misread as repo-level.
  // Falls back to the release set when the engine didn't populate it (e.g. tests).
  const workspace = config.allWorkspacePackages ?? packages.map((p) => ({ name: p.packageJson.name, dir: p.dir }));
  const sharedPackagePatterns = config.sharedPackages ?? [];
  // Commits to a shared package are listed as project-wide. Nested packages are in the list themselves, so no scope
  // excludes them. The workspace root is left out, since owning it would claim every commit.
  const workspaceRoot = path.resolve(repoRoot);
  const ownedDirs = (shared: boolean) =>
    workspace
      .filter((p) => shouldMatchPackageTargets(p.name, sharedPackagePatterns) === shared)
      .flatMap((p) => resolveCommitScope(p.dir, config, { repoRoot, releasableDirs: [] }).scope)
      .filter((dir) => dir !== workspaceRoot);
  return {
    workspaceRoot,
    packageOwnedDirs: ownedDirs(false),
    sharedPackageDirs: ownedDirs(true),
    entries: new Map(),
  };
}

function shouldProcess(pkg: Package, config: Config): boolean {
  return shouldProcessPackage(pkg.packageJson.name, config.skip);
}

/** The prefix of the repo's release tags a package falls back to, or none when tags are per package. */
function globalPrefixFor(config: Config, formattedPrefix: string, name: string): string | undefined {
  return (
    deriveBaselineTagPrefix(config.baselineTagTemplate, formattedPrefix, name) ??
    (config.packageSpecificTags ? undefined : deriveBaselineTagPrefix(config.tagTemplate, formattedPrefix, name))
  );
}

function globalTag(ctx: RunContext, prefix: string | undefined): Promise<string> {
  let tag = ctx.globalTags.get(prefix);
  if (!tag) {
    tag = getLatestTag(prefix);
    ctx.globalTags.set(prefix, tag);
  }
  return tag;
}

/** A package's last release tag and the version it would bump to on its own. */
async function planPackage(
  ctx: RunContext,
  pkg: Package,
  current: CurrentVersion,
  excluded = false,
): Promise<PackagePlan> {
  const { config, formattedPrefix } = ctx;
  const name = pkg.packageJson.name;

  // With baselineTagTemplate set, only the baseline tags are read: a consumer tag may have been moved off the branch.
  let latestTag = '';
  let usedPackageSpecificTag = false;
  if (!config.baselineTagTemplate) {
    latestTag = await getLatestTagForPackage(name, formattedPrefix, {
      tagTemplate: config.tagTemplate,
      packageSpecificTags: config.packageSpecificTags,
    });
    usedPackageSpecificTag = !!latestTag;
  }
  const globalPrefix = globalPrefixFor(config, formattedPrefix, name);
  if (!latestTag) {
    latestTag = await globalTag(ctx, globalPrefix);
  }
  if (!latestTag && !config.baseRef && !excluded) {
    await checkUnreachableTags(
      [
        ...(config.baselineTagTemplate
          ? []
          : [
              {
                packageName: name,
                versionPrefix: formattedPrefix,
                options: { tagTemplate: config.tagTemplate, packageSpecificTags: config.packageSpecificTags },
              },
            ]),
        { globalPrefix },
      ],
      config.strictReachable ?? false,
    );
  }

  const { scope: commitScope, pathsError } = resolveCommitScope(pkg.dir, config, {
    repoRoot: ctx.repoRoot,
    ignorePaths: ctx.ignorePaths,
  });
  const ownNext = await calculateVersion(config, {
    latestTag,
    versionPrefix: formattedPrefix,
    prereleaseIdentifier: config.prereleaseIdentifier,
    path: pkg.dir,
    commitScope,
    name,
    type: config.type,
    current,
  });

  return {
    pkg,
    baseline: current.version,
    latestTag,
    usedPackageSpecificTag,
    globalPrefix,
    ownNext,
    changed: !!ownNext,
    commitScope,
    ...(pathsError ? { pathsError } : {}),
  };
}

function bumpManifests(ctx: RunContext, pkg: Package, version: string): void {
  const { config } = ctx;
  const name = pkg.packageJson.name;
  const packageJsonPath = path.join(pkg.dir, 'package.json');
  if (config.npm?.enabled !== false && fs.existsSync(packageJsonPath)) {
    updatePackageVersion(packageJsonPath, version, config.dryRun);
  } else {
    const reason =
      config.npm?.enabled === false ? 'npm version handling disabled' : 'no package.json found (native-only package)';
    log(`Skipping package.json update for ${name} - ${reason}`, 'debug');
  }
  updateNativeManifests(pkg.dir, version, config, {
    dryRun: config.dryRun,
    repoRoot: ctx.repoRoot,
    recordAs: name,
    ignorePaths: ctx.ignorePaths,
  });
}

function readRepoUrl(pkgDir: string): string | null {
  try {
    const pkgJsonPath = path.join(pkgDir, 'package.json');
    if (!fs.existsSync(pkgJsonPath)) {
      return null;
    }
    const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
    let url: string | undefined = typeof pkgJson.repository === 'string' ? pkgJson.repository : pkgJson.repository?.url;
    if (!url) {
      return null;
    }
    if (url.startsWith('git+')) {
      url = url.slice(4);
    }
    if (url.endsWith('.git')) {
      url = url.slice(0, -4);
    }
    return url;
  } catch {
    return null;
  }
}

interface PackageEntries {
  entries: ChangelogEntry[];
  revisionRange: string;
  previousVersion: string | null;
  sharedPackageEntries?: ChangelogEntry[];
}

/** A package's changelog entries since its last release, and in async mode the project-wide entries it brings. */
async function collectEntries(
  ctx: RunContext,
  plan: PackagePlan,
  version: string,
  /** A fixed-group ride-along with no releasable change of its own. */
  isCarry: boolean,
): Promise<PackageEntries> {
  const { config, formattedPrefix, shared } = ctx;
  const { pkg, latestTag } = plan;
  const name = pkg.packageJson.name;
  let revisionRange = 'HEAD';
  let previousVersion: string | null = null;
  let entries: ChangelogEntry[] = [];
  let sharedPackageEntries: ChangelogEntry[] | undefined;
  try {
    const baseline = await ctx.resolver.resolve({
      pkgDir: pkg.dir,
      latestTag,
      hasRealTag: latestTag !== '',
      usedPackageSpecificTag: plan.usedPackageSpecificTag,
      globalTagPrefix: plan.globalPrefix,
      nextVersion: version,
      graduationName: name,
      baselineTagPrefix: deriveBaselineTagPrefix(config.baselineTagTemplate, formattedPrefix, name),
      formattedPrefix,
    });
    revisionRange = baseline.revisionRange;
    previousVersion = baseline.previousVersion;

    if (!latestTag && !config.baseRef && !isCarry) {
      const currentVersion = pkg.packageJson.version;
      const suggestedTag = currentVersion
        ? formatTag(currentVersion, formattedPrefix, name, config.tagTemplate, config.packageSpecificTags)
        : undefined;
      const scope =
        revisionRange === 'HEAD'
          ? 'include the full git history'
          : `start from ${revisionRange.replace(/\.\.HEAD$/, '')}`;
      log(
        `No prior tag found for ${name} — its changelog will ${scope}.` +
          (suggestedTag
            ? ` Create a baseline tag to scope it: git tag ${suggestedTag} <release-sha> && git push origin ${suggestedTag}`
            : ''),
        'warning',
      );
    }

    entries = await extractChangelogEntriesFromCommits(pkg.dir, revisionRange, config.preset, plan.commitScope);

    if (shared) {
      // Bounded so one untagged package can't flood "Project-wide changes" with the entire history.
      const sharedRevisionRange = await ctx.resolver.sharedFloor(revisionRange);
      const repoLevelEntries = await extractRepoLevelChangelogEntries(
        pkg.dir,
        sharedRevisionRange,
        config.preset,
        shared.packageOwnedDirs,
        shared.sharedPackageDirs,
      );
      // Emitted once on VersionOutput rather than duplicated into every package changelog.
      for (const entry of repoLevelEntries) {
        shared.entries.set(`${entry.type}${entry.breaking ? '!' : ''}:${entry.description}`, entry);
      }

      // The package's own range, so a shared-package change its previous release listed doesn't come back. A shared
      // package's own dirs are left out too: its changelog already lists those commits.
      if (shared.sharedPackageDirs.length > 0) {
        const ownDirs = resolveCommitScope(pkg.dir, config, {
          repoRoot: ctx.repoRoot,
          releasableDirs: [],
        }).scope.filter((dir) => dir !== shared.workspaceRoot);
        const packageEntries = await extractRepoLevelChangelogEntries(
          pkg.dir,
          revisionRange,
          config.preset,
          [...shared.packageOwnedDirs, ...ownDirs],
          shared.sharedPackageDirs,
        );
        sharedPackageEntries = packageEntries.filter((e) => e.sharedPackage);
      }
    }
  } catch (error) {
    if (error instanceof StrictReachableError) {
      throw error;
    }
    log(`Error extracting changelog entries: ${error instanceof Error ? error.message : String(error)}`, 'warning');
  }
  if (entries.length === 0) {
    // Only a carry is flagged synthetic (the preview collapses those into "Also bumped"). A changed package
    // that came back empty hit a swallowed git failure, so it stays unflagged and renders visibly.
    const fallback: ChangelogEntry = { type: 'changed', description: `Update version to ${version}` };
    if (isCarry) {
      fallback.synthetic = true;
    }
    entries = [fallback];
  }
  return { entries, revisionRange, previousVersion, ...(sharedPackageEntries ? { sharedPackageEntries } : {}) };
}

/** Records a released package's tag, action, changelog and baseline tag. */
async function recordRelease(
  ctx: RunContext,
  plan: PackagePlan,
  version: string,
  tag: string,
  isCarry: boolean,
): Promise<void> {
  const { config, formattedPrefix } = ctx;
  const name = plan.pkg.packageJson.name;
  addTag(tag);
  setPackageUpdateTag(name, tag);
  const { action, reason } = resolveVersionAction({
    hasNoTags: plan.latestTag === '',
    latestTag: plan.latestTag,
    nextVersion: version,
  });
  setPackageUpdateAction(name, action, reason);

  const { entries, revisionRange, previousVersion, sharedPackageEntries } = await collectEntries(
    ctx,
    plan,
    version,
    isCarry,
  );
  addChangelogData({
    packageName: name,
    version,
    previousVersion,
    revisionRange,
    repoUrl: readRepoUrl(plan.pkg.dir),
    entries,
    tag,
    ...(sharedPackageEntries ? { sharedPackageEntries } : {}),
  });
  setPackageUpdatePreviousVersion(name, previousVersion);
  if (config.baselineTagTemplate) {
    addBaselineTag(formatTag(version, formattedPrefix, name, config.baselineTagTemplate, false));
  }
}

/** Releases a package outside any group, at its own next version. */
async function releasePackage(ctx: RunContext, pkg: Package): Promise<ReleasedPackage | undefined> {
  const { config } = ctx;
  const name = pkg.packageJson.name;
  const plan = await planPackage(ctx, pkg, ctx.record.current(pkg, config));
  if (!plan.changed) {
    return undefined;
  }
  // Before any write for this package, so a release never bumps package.json and then fails on a native manifest.
  if (plan.pathsError) {
    throw plan.pathsError;
  }
  if (!checkManifestToBump(name, pkg.dir, config, { repoRoot: ctx.repoRoot, ignorePaths: ctx.ignorePaths })) {
    return undefined;
  }

  const version = plan.ownNext;
  bumpManifests(ctx, pkg, version);
  const tag = formatTag(version, ctx.formattedPrefix, name, config.tagTemplate, config.packageSpecificTags);
  await recordRelease(ctx, plan, version, tag, false);
  log(
    config.dryRun
      ? `[DRY RUN] Would release ${name} at ${version} (tag: ${tag})`
      : `${name} prepared at ${version} (tag: ${tag})`,
    config.dryRun ? 'info' : 'success',
  );
  return { name, version };
}

/** Releases a declared group's changed members, or all of a fixed group's members, at the group's version. */
async function versionGroup(
  ctx: RunContext,
  group: ResolvedGroup,
  targeted: (pkg: Package) => boolean,
): Promise<ReleasedPackage[]> {
  const { config, record } = ctx;
  const members = group.members
    .filter(targeted)
    .filter((p) => shouldProcess(p, config))
    // Dropped before planning, so a member with nothing to bump can't set the group's version.
    .filter((p) => hasManifestToBump(p.dir, config, { ignorePaths: true }));
  if (members.length === 0) {
    return [];
  }

  const groupCurrent = group.sync === 'independent' ? undefined : record.groupCurrent(members, config);
  const currentOf = (pkg: Package) => record.current(pkg, config, groupCurrent);
  const plans = await Promise.all(members.map((pkg) => planPackage(ctx, pkg, currentOf(pkg))));
  const computation = computeGroup(group, plans, config);

  if (!computation.hasChange) {
    log(`Group "${group.name}": no releasable changes, skipping.`, 'info');
    return [];
  }

  // config.skip and the target filter can leave an atomic group partial. Fixed breaks if any member is
  // missing; independent only if a *changed* one is, so excluded members are planned to avoid a false
  // alarm. Linked groups release partially by design.
  if (group.sync !== 'linked') {
    const inRelease = new Set(members.map((m) => m.packageJson.name));
    const excludedMembers = group.members.filter((m) => !inRelease.has(m.packageJson.name));
    let droppedNames: string[];
    if (group.sync === 'fixed') {
      droppedNames = excludedMembers.map((m) => m.packageJson.name);
    } else {
      const excludedPlans = await Promise.all(excludedMembers.map((m) => planPackage(ctx, m, currentOf(m), true)));
      droppedNames = excludedPlans.filter((p) => p.changed).map((p) => p.pkg.packageJson.name);
    }
    if (droppedNames.length > 0) {
      log(
        `Group "${group.name}" (${group.sync}) will release without: ${droppedNames.join(', ')}. ` +
          'They were excluded by config.skip or --target, or have no manifest releasekit can bump, so the ' +
          'group will not ship as a single atomic unit. Include them (remove from config.skip or add via ' +
          '--target) to keep the group atomic.',
        'warning',
      );
    }
  }

  const { groupVersion, releasing } = computation;
  log(
    group.sync === 'independent'
      ? `Group "${group.name}" (independent): releasing ${releasing.length} member(s) on their own version lines.`
      : `Group "${group.name}" (${group.sync}): releasing ${releasing.length} member(s) at ${groupVersion}.`,
    'info',
  );

  const released: ReleasedPackage[] = [];
  for (const plan of releasing) {
    const name = plan.pkg.packageJson.name;
    const version = group.sync === 'independent' ? plan.ownNext : groupVersion;

    if (group.sync !== 'independent' && semver.valid(plan.baseline) && semver.lt(plan.baseline, version)) {
      const singleMajorBump = semver.inc(plan.baseline, 'major') ?? plan.baseline;
      if (semver.gt(version, singleMajorBump)) {
        log(
          `Group "${group.name}": ${name} adopts group version ${version} (was ${plan.baseline}). ` +
            'This skips intermediate versions with no semver event behind the jump — time group ' +
            'migrations to a real breaking change in the family.',
          'warning',
        );
      } else if (!plan.changed) {
        log(`Group "${group.name}": ${name} rides along to ${version} (was ${plan.baseline}).`, 'info');
      }
    }

    bumpManifests(ctx, plan.pkg, version);
    // Always package-specific so each member's release is individually addressable.
    const tag = formatTag(version, ctx.formattedPrefix, name, config.tagTemplate, true);
    setPackageUpdateGroup(name, group.name);
    await recordRelease(ctx, plan, version, tag, !plan.changed);
    released.push({ name, version });
    log(
      config.dryRun
        ? `[DRY RUN] Group "${group.name}": would release ${name} at ${version} (tag: ${tag})`
        : `Group "${group.name}": ${name} prepared at ${version} (tag: ${tag})`,
      config.dryRun ? 'info' : 'success',
    );
  }
  return released;
}

/**
 * Releases every package at one version computed from commits anywhere in the repo, bumping the root manifests too.
 * Without `packageSpecificTags` the release has one tag and one changelog, named after `mainPackage`.
 */
async function releaseSyncGroup(
  ctx: RunContext,
  packages: PackagesWithRoot,
  discovered: Package[],
): Promise<{ released: ReleasedPackage[]; version: string } | undefined> {
  const { config, formattedPrefix, repoRoot } = ctx;
  const { tagTemplate, prereleaseIdentifier, dryRun, mainPackage } = config;

  const baselineTagPrefix = deriveBaselineTagPrefix(config.baselineTagTemplate, formattedPrefix, mainPackage);
  // With packageSpecificTags this only backs up the per-package lookup below, so it accepts any version tag.
  const globalPrefix =
    baselineTagPrefix ??
    (config.packageSpecificTags ? undefined : deriveBaselineTagPrefix(tagTemplate, formattedPrefix));
  let latestTag = await getLatestTag(globalPrefix);

  // `paths` entries are confined to the workspace, so nothing a synced package versions lives outside it.
  const commitScope = [repoRoot];

  // mainPkgPath/Name name the changelog and baseline tag and locate the repo URL; versionSourcePath/Name
  // only supply the package-specific tag lookup.
  let mainPkgPath = packages.root;
  let mainPkgName: string | undefined;
  let versionSourcePath = mainPkgPath;
  let versionSourceName: string | undefined;

  if (mainPackage) {
    const mainPkg = packages.packages.find((p) => p.packageJson.name === mainPackage);
    if (mainPkg) {
      mainPkgPath = mainPkg.dir;
      mainPkgName = mainPkg.packageJson.name;
      versionSourcePath = mainPkgPath;
      versionSourceName = mainPkgName;
      log(`Using ${mainPkgName} as the primary package for the changelog and tag lookup`, 'info');
    } else {
      log(`Main package '${mainPackage}' not found. Using the root package for the changelog.`, 'warning');
    }
  } else if (packages.packages.length > 0) {
    versionSourcePath = packages.packages[0].dir;
    versionSourceName = packages.packages[0].packageJson.name;
    log(`No mainPackage specified; using ${versionSourceName} for the tag lookup`, 'info');
  }

  if (!mainPkgPath) {
    mainPkgPath = process.cwd();
    log(`No valid package path found, using current working directory: ${mainPkgPath}`, 'warning');
  }

  // With `baselineTagTemplate` set the baseline lookup above is authoritative - a consumer-facing
  // package tag may have been moved off the branch.
  let usedPackageSpecificTag = false;
  if (versionSourceName && !config.baselineTagTemplate) {
    const packageSpecificTag = await getLatestTagForPackage(versionSourceName, formattedPrefix, {
      tagTemplate,
      packageSpecificTags: config.packageSpecificTags,
    });

    if (packageSpecificTag) {
      latestTag = packageSpecificTag;
      usedPackageSpecificTag = true;
      log(`Using package-specific tag for ${versionSourceName}: ${latestTag}`, 'debug');
    } else {
      log(`No package-specific tag found for ${versionSourceName}, using global tag: ${latestTag}`, 'debug');
    }
  }

  if (!latestTag && !config.baseRef) {
    await checkUnreachableTags(
      [
        { globalPrefix },
        ...(versionSourceName && !config.baselineTagTemplate
          ? [
              {
                packageName: versionSourceName,
                versionPrefix: formattedPrefix,
                options: { tagTemplate, packageSpecificTags: config.packageSpecificTags },
              },
            ]
          : []),
      ],
      config.strictReachable ?? false,
    );
  }

  const nextVersion = await calculateVersion(config, {
    latestTag,
    versionPrefix: formattedPrefix,
    prereleaseIdentifier,
    path: versionSourcePath,
    commitScope,
    name: versionSourceName,
    type: config.type,
    current: ctx.record.groupCurrent(packages.packages, config),
  });

  if (!nextVersion) {
    log(mainPkgName ? `No version change needed for ${mainPkgName}` : 'No version change needed', 'info');
    return undefined;
  }

  const updatedPackages: string[] = [];
  const processedPaths = new Set<string>();

  const rootPackage = packages.packages.find((p) => path.resolve(p.dir) === path.resolve(repoRoot));
  // A root that is a package this run leaves out (version.packages, --target, --exclude) isn't released.
  const rootLeftOut = !rootPackage && discovered.some((p) => path.resolve(p.dir) === path.resolve(repoRoot));
  if (rootLeftOut) {
    log('Not bumping the root manifests: the root package is left out of this release', 'info');
    processedPaths.add(path.join(repoRoot, 'package.json'));
  } else {
    const rootPkgPath = path.join(repoRoot, 'package.json');
    try {
      if (config.npm?.enabled !== false && fs.existsSync(rootPkgPath)) {
        // Flag as root so consumers (preview, standing PR) exclude it from package counts - it isn't publishable.
        updatePackageVersion(rootPkgPath, nextVersion, dryRun, { isRoot: true });
        updatedPackages.push('root');
      }
    } catch (error) {
      const errMessage = error instanceof Error ? error.message : String(error);
      log(`Failed to update root package.json: ${errMessage}`, 'error');
    }
    // Record even when npm is disabled so the loop skips it in a single-package repo (where
    // packages.root === packages[0].dir) - otherwise its native manifests are versioned twice.
    processedPaths.add(rootPkgPath);

    // In a single-package repo the root is the package, so its manifests take the name discovery knows it by.
    const rootNativeFiles = updateNativeManifests(repoRoot, nextVersion, config, {
      dryRun,
      repoRoot,
      // A root that is itself a discovered package releases like any other, so only a non-package root is flagged.
      isRoot: !rootPackage,
      recordAs: rootPackage?.packageJson.name,
    });
    // Track a native-only root bump: the loop skips this path in a single-package repo, so the early
    // return below would otherwise abandon the written file.
    if (rootNativeFiles.length > 0 && !updatedPackages.includes('root')) {
      updatedPackages.push('root');
    }
  }

  for (const pkg of packages.packages) {
    if (!shouldProcess(pkg, config)) {
      continue;
    }

    const packageJsonPath = path.join(pkg.dir, 'package.json');

    if (processedPaths.has(packageJsonPath) || !hasManifestToBump(pkg.dir, config, { repoRoot })) {
      continue;
    }

    const npmBumped = config.npm?.enabled !== false && fs.existsSync(packageJsonPath);
    if (npmBumped) {
      updatePackageVersion(packageJsonPath, nextVersion, dryRun);
      updatedPackages.push(pkg.packageJson.name);
      processedPaths.add(packageJsonPath);
    } else {
      const reason =
        config.npm?.enabled === false ? 'npm version handling disabled' : 'no package.json found (native-only package)';
      log(`Skipping package.json update for ${pkg.packageJson.name} - ${reason}`, 'debug');
    }

    const nativeFiles = updateNativeManifests(pkg.dir, nextVersion, config, {
      dryRun,
      repoRoot,
      recordAs: pkg.packageJson.name,
    });
    // Track native-only updates, or the early return below abandons the written manifests.
    if (!npmBumped && nativeFiles.length > 0) {
      updatedPackages.push(pkg.packageJson.name);
    }
  }

  if (updatedPackages.length === 0) {
    log('No packages were updated', 'warning');
    return undefined;
  }
  log(`Updated ${updatedPackages.length} package(s) to version ${nextVersion}`, 'success');

  const baselineResolver = new BaselineResolver({
    versionPrefix: formattedPrefix,
    globalTagPrefix: globalPrefix,
    tagTemplate,
    packageSpecificTags: config.packageSpecificTags ?? false,
    strictReachable: config.strictReachable ?? false,
    baseRef: config.baseRef,
  });

  let changelogEntries: ChangelogEntry[] = [];
  let revisionRange = 'HEAD';
  let previousVersion: string | null = null;

  try {
    const baseline = await baselineResolver.resolve({
      pkgDir: mainPkgPath,
      latestTag,
      hasRealTag: latestTag !== '',
      usedPackageSpecificTag,
      nextVersion,
      graduationName: versionSourceName,
      baselineTagPrefix,
      formattedPrefix,
    });
    revisionRange = baseline.revisionRange;
    previousVersion = baseline.previousVersion;
    changelogEntries = await extractChangelogEntriesFromCommits(repoRoot, revisionRange, config.preset, commitScope);
  } catch (error) {
    if (error instanceof StrictReachableError) {
      throw error;
    }
    log(`Error extracting changelog entries: ${error instanceof Error ? error.message : String(error)}`, 'warning');
  }
  if (changelogEntries.length === 0) {
    changelogEntries = [{ type: 'changed', description: `Update version to ${nextVersion}` }];
  }

  const workspaceNames = updatedPackages.filter((n) => n !== 'root');
  const repoUrl = readRepoUrl(mainPkgPath) ?? (versionSourcePath ? readRepoUrl(versionSourcePath) : null);

  // One entry per workspace package in per-package tag mode, so notes can write each package's
  // CHANGELOG.md and publish can match tags to the right release notes.
  const perPackage = config.packageSpecificTags && workspaceNames.length > 0;
  // A root-only release (a single-package repo) names its package-specific tag after the version source.
  const tags = perPackage
    ? workspaceNames.map((pkgName) => formatTag(nextVersion, formattedPrefix, pkgName, tagTemplate, true))
    : [
        formatTag(
          nextVersion,
          formattedPrefix,
          config.packageSpecificTags ? versionSourceName : null,
          tagTemplate,
          false,
        ),
      ];
  const changelogNames = perPackage ? workspaceNames : [mainPkgName || 'monorepo'];
  for (const [i, packageName] of changelogNames.entries()) {
    addChangelogData({
      packageName,
      version: nextVersion,
      previousVersion,
      revisionRange,
      repoUrl,
      entries: changelogEntries,
      tag: tags[i],
    });
  }

  for (const tag of tags) {
    addTag(tag);
  }
  const baselineTag = config.baselineTagTemplate
    ? formatTag(nextVersion, formattedPrefix, mainPkgName, config.baselineTagTemplate, false)
    : undefined;
  if (baselineTag) {
    addBaselineTag(baselineTag);
  }
  // Link per-package tags back to their update records so the publish pipeline
  // can push each tag immediately after that package publishes.
  if (perPackage) {
    for (const [i, pkgName] of workspaceNames.entries()) {
      setPackageUpdateTag(pkgName, tags[i]);
    }
  }
  const { action, reason } = resolveVersionAction({ hasNoTags: latestTag === '', latestTag, nextVersion });
  setAllPackageUpdateActions(action, reason);
  setAllPackageUpdatePreviousVersions(previousVersion);

  const allTags = baselineTag ? [...tags, baselineTag] : tags;
  log(
    dryRun
      ? `Would create tags: ${allTags.join(', ')}`
      : `Version ${nextVersion} prepared (tags: ${allTags.join(', ')})`,
    dryRun ? 'info' : 'success',
  );
  return { released: workspaceNames.map((name) => ({ name, version: nextVersion })), version: nextVersion };
}
