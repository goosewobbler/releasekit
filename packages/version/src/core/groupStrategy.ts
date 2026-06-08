/**
 * Version-group strategy: the single engine behind `fixed` / `linked` groups and the implicit
 * all-packages fixed group that `version.sync: true` desugars to.
 *
 * Per group:
 *  1. Resolve every member's baseline (highest of git tag / manifest version) and the version it
 *     would independently bump to.
 *  2. The group baseline is `max(member baselines)`. The group bump magnitude is the largest bump
 *     any member earned. The group version is `bump(max baseline)` applied once.
 *  3. fixed:  ALL members are written to the group version (provided at least one member changed).
 *     linked: only members that earned a releasable change are written, all at the group version.
 *
 * Members below the group baseline (never-released packages, or an existing package at an older
 * version joining a higher family) ADOPT the group version on release — this deliberately
 * overrides the per-package "initial version from package.json" rule. A jump larger than a single
 * bump is warned about so adopters notice the alignment.
 */

import fs from 'node:fs';
import * as path from 'node:path';
import type { Package } from '@manypkg/get-packages';
import type { VersionChangelogEntry } from '@releasekit/core';
import { shouldMatchPackageTargets, shouldProcessPackage as shouldProcessPackageUtil } from '@releasekit/core';
import semver from 'semver';
import { extractChangelogEntriesFromCommits } from '../changelog/commitParser.js';
import { BaseVersionError } from '../errors/baseError.js';
import { execSync } from '../git/commandExecutor.js';
import { getLatestTag, getLatestTagForPackage } from '../git/tagsAndBranches.js';
import { updatePackageVersion } from '../package/packageManagement.js';
import type { Config } from '../types.js';
import {
  deriveBaselineTagPrefix,
  displayTag,
  formatCommitMessage,
  formatTag,
  formatVersionPrefix,
} from '../utils/formatting.js';
import {
  addBaselineTag,
  addChangelogData,
  addTag,
  setCommitMessage,
  setPackageUpdateGroup,
  setPackageUpdateTag,
  setVersioningStrategy,
} from '../utils/jsonOutput.js';
import { log } from '../utils/logging.js';
import { expandTargetsForFixedGroups, type ResolvedGroup, resolveGroups } from './groupResolution.js';
import { calculateVersion } from './versionCalculator.js';
import type { PackagesWithRoot } from './versionEngine.js';

type ChangelogEntry = VersionChangelogEntry;

/** Ordering of bump magnitudes so we can take the max across group members. */
const BUMP_RANK: Record<string, number> = {
  patch: 1,
  prepatch: 1,
  minor: 2,
  preminor: 2,
  major: 3,
  premajor: 3,
  prerelease: 0,
};

interface MemberPlan {
  pkg: Package;
  /** Resolved current version (baseline) for this member. */
  baseline: string;
  /** The tag the changelog/revision range is computed against, or '' when none. */
  latestTag: string;
  /** Version this member would bump to on its own ('' when it earned no releasable change). */
  ownNext: string;
  /** Whether this member earned a releasable change. */
  changed: boolean;
}

function cleanBaseline(version: string | undefined): string {
  if (!version) return '0.0.0';
  return semver.valid(semver.coerce(version) ?? '') ?? semver.clean(version) ?? '0.0.0';
}

/**
 * Resolve a single member's baseline + the version it would bump to independently. Reuses the
 * shared tag-resolution path so per-package tags (`tagTemplate`) and the manifest fallback behave
 * exactly as they do in the per-package strategy.
 */
async function planMember(
  config: Config,
  pkg: Package,
  formattedPrefix: string,
  globalTag: string,
): Promise<MemberPlan> {
  const name = pkg.packageJson.name;

  let latestTag = '';
  if (!config.baselineTagTemplate) {
    latestTag = await getLatestTagForPackage(name, formattedPrefix, {
      tagTemplate: config.tagTemplate,
      packageSpecificTags: config.packageSpecificTags,
    });
  }
  if (!latestTag) latestTag = globalTag;

  const ownNext = await calculateVersion(config, {
    latestTag,
    versionPrefix: formattedPrefix,
    branchPattern: config.branchPattern,
    baseBranch: config.baseBranch,
    prereleaseIdentifier: config.prereleaseIdentifier,
    path: pkg.dir,
    name,
    type: config.type,
  });

  // Baseline: the package's resolved current version. Prefer the manifest version when present
  // (it's already the package's effective version), else derive from the tag.
  const manifestVersion = pkg.packageJson.version;
  const tagVersion = latestTag ? cleanBaseline(latestTag) : undefined;
  const candidates = [manifestVersion, tagVersion].map(cleanBaseline).filter((v) => v !== '0.0.0');
  const baseline = candidates.length > 0 ? candidates.sort(semver.rcompare)[0] : '0.0.0';

  return { pkg, baseline, latestTag, ownNext, changed: !!ownNext };
}

/** Derive the bump magnitude a member earned by comparing its computed next version to baseline. */
function memberBumpRank(plan: MemberPlan): number {
  if (!plan.changed) return -1;
  const diff = semver.diff(plan.baseline, plan.ownNext);
  if (!diff) {
    // Same version family (e.g. prerelease increment) — treat as a patch-level change so the
    // group still advances.
    return BUMP_RANK.patch;
  }
  return BUMP_RANK[diff] ?? BUMP_RANK.patch;
}

const RANK_TO_TYPE: Record<number, 'patch' | 'minor' | 'major'> = {
  1: 'patch',
  2: 'minor',
  3: 'major',
};

interface GroupComputation {
  /** The shared version every releasing member is written to. */
  groupVersion: string;
  /** Members that will be released (all members for fixed, changed members for linked). */
  releasing: MemberPlan[];
  /** Whether the group has any releasable change at all. */
  hasChange: boolean;
}

/**
 * Compute the group version and the set of releasing members from each member's independent plan.
 */
function computeGroup(group: ResolvedGroup, plans: MemberPlan[]): GroupComputation {
  const changedPlans = plans.filter((p) => p.changed);
  if (changedPlans.length === 0) {
    return { groupVersion: '', releasing: [], hasChange: false };
  }

  const maxBaseline = plans.map((p) => p.baseline).sort(semver.rcompare)[0];
  const maxRank = Math.max(...changedPlans.map(memberBumpRank));
  const bumpType = RANK_TO_TYPE[maxRank] ?? 'patch';

  // Apply the aggregate bump once to the highest baseline in the group. semver.inc handles the
  // stable case; prerelease groups fall back to each member's own computed next version where the
  // bumped value would be lower than the maximum already-computed member version.
  let groupVersion = semver.inc(maxBaseline, bumpType) ?? maxBaseline;

  // Never let the group version regress below any member's independently-computed next version
  // (covers prerelease increments and members whose own bump already exceeded the aggregate).
  for (const plan of changedPlans) {
    if (semver.valid(plan.ownNext) && semver.gt(plan.ownNext, groupVersion)) {
      groupVersion = plan.ownNext;
    }
  }

  const releasing = group.sync === 'fixed' ? plans : changedPlans;
  return { groupVersion, releasing, hasChange: true };
}

function shouldProcess(pkg: Package, config: Config): boolean {
  return shouldProcessPackageUtil(pkg.packageJson.name, config.skip);
}

function readRepoUrl(pkgDir: string): string | null {
  try {
    const pkgJsonPath = path.join(pkgDir, 'package.json');
    if (!fs.existsSync(pkgJsonPath)) return null;
    const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
    let url: string | undefined = typeof pkgJson.repository === 'string' ? pkgJson.repository : pkgJson.repository?.url;
    if (!url) return null;
    if (url.startsWith('git+')) url = url.slice(4);
    if (url.endsWith('.git')) url = url.slice(0, -4);
    return url;
  } catch {
    return null;
  }
}

function extractEntries(
  pkgDir: string,
  latestTag: string,
  version: string,
  config: Config,
): {
  entries: ChangelogEntry[];
  revisionRange: string;
} {
  let revisionRange = 'HEAD';
  let entries: ChangelogEntry[] = [];
  try {
    const baseForRange = config.baseRef ?? latestTag;
    if (baseForRange) {
      try {
        execSync('git', ['rev-parse', '--verify', baseForRange], { cwd: pkgDir, stdio: 'ignore' });
        revisionRange = `${baseForRange}..HEAD`;
      } catch {
        if (!config.baseRef && config.strictReachable) {
          throw new Error(
            `Cannot generate changelog: ref '${baseForRange}' is not reachable from the current commit. ` +
              'When strictReachable is enabled, all refs must be reachable.',
          );
        }
        revisionRange = 'HEAD';
      }
    }
    entries = extractChangelogEntriesFromCommits(pkgDir, revisionRange);
  } catch (error) {
    log(`Error extracting changelog entries: ${error instanceof Error ? error.message : String(error)}`, 'warning');
  }
  if (entries.length === 0) {
    entries = [{ type: 'changed', description: `Update version to ${version}` }];
  }
  return { entries, revisionRange };
}

/**
 * Release one group: write the group version to every releasing member, emit per-package tags +
 * changelog data, and tag each update with the group name for downstream CI surfaces.
 * Returns the names of the packages that were written (for commit-message aggregation).
 */
function releaseGroup(group: ResolvedGroup, computation: GroupComputation, config: Config): string[] {
  const { groupVersion, releasing } = computation;
  const formattedPrefix = formatVersionPrefix(config.versionPrefix || 'v');
  const released: string[] = [];

  for (const plan of releasing) {
    const pkg = plan.pkg;
    const name = pkg.packageJson.name;
    if (!shouldProcess(pkg, config)) continue;

    // Adoption: a member below the group version jumps to it. Warn loudly when the jump skips
    // versions — i.e. the group version is strictly beyond what a single major bump of this member
    // would have produced — so adopters time the migration to a real breaking change. An unchanged
    // member that is nonetheless released (fixed group) is the routine lockstep case: just log it at
    // info level, since it doesn't skip any versions for that member.
    if (semver.valid(plan.baseline) && semver.lt(plan.baseline, groupVersion)) {
      const singleMajorBump = semver.inc(plan.baseline, 'major') ?? plan.baseline;
      const jumpsMoreThanOneBump = semver.gt(groupVersion, singleMajorBump);
      if (jumpsMoreThanOneBump) {
        log(
          `Group "${group.name}": ${name} adopts group version ${groupVersion} (was ${plan.baseline}). ` +
            'This skips intermediate versions with no semver event behind the jump — time group ' +
            'migrations to a real breaking change in the family.',
          'warning',
        );
      } else if (!plan.changed) {
        log(`Group "${group.name}": ${name} rides along to ${groupVersion} (was ${plan.baseline}).`, 'info');
      }
    }

    const packageJsonPath = path.join(pkg.dir, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      updatePackageVersion(packageJsonPath, groupVersion, config.dryRun);
    } else {
      log(`Skipping package.json update for ${name} - no package.json found (Rust-only package)`, 'debug');
    }

    // Cargo handled the same way as other strategies (default path only — paths config applies
    // to single/async; group members are package-keyed).
    const cargoTomlPath = path.join(pkg.dir, 'Cargo.toml');
    if (config.cargo?.enabled !== false && fs.existsSync(cargoTomlPath)) {
      updatePackageVersion(cargoTomlPath, groupVersion, config.dryRun);
    }

    // Per-package tag + changelog. Group members always get package-specific tags so each
    // member's release is individually addressable (the group acts atomically at the version level,
    // not the tag level).
    const tag = formatTag(groupVersion, formattedPrefix, name, config.tagTemplate, true);
    addTag(tag);
    setPackageUpdateTag(name, tag);
    setPackageUpdateGroup(name, group.name);

    const baselineTagPrefix = deriveBaselineTagPrefix(config.baselineTagTemplate, formattedPrefix, name);
    const { entries, revisionRange } = extractEntries(pkg.dir, plan.latestTag, groupVersion, config);
    addChangelogData({
      packageName: name,
      version: groupVersion,
      previousVersion: plan.latestTag ? displayTag(plan.latestTag, baselineTagPrefix, formattedPrefix) : null,
      revisionRange,
      repoUrl: readRepoUrl(pkg.dir),
      entries,
    });

    if (config.baselineTagTemplate) {
      addBaselineTag(formatTag(groupVersion, formattedPrefix, name, config.baselineTagTemplate, false));
    }

    released.push(name);
    log(
      config.dryRun
        ? `[DRY RUN] Group "${group.name}": would release ${name} at ${groupVersion} (tag: ${tag})`
        : `Group "${group.name}": ${name} prepared at ${groupVersion} (tag: ${tag})`,
      config.dryRun ? 'info' : 'success',
    );
  }

  return released;
}

/**
 * Create the version-group strategy. Handles every configured group (explicit `version.groups`
 * and the implicit `sync: true` group), plus any ungrouped packages which version independently.
 */
export function createGroupStrategy(config: Config): (packages: PackagesWithRoot, targets?: string[]) => Promise<void> {
  return async (packages: PackagesWithRoot, runtimeTargets: string[] = []): Promise<void> => {
    try {
      setVersioningStrategy('group');
      const formattedPrefix = formatVersionPrefix(config.versionPrefix || 'v');
      const globalTag = await getLatestTag(deriveBaselineTagPrefix(config.baselineTagTemplate, formattedPrefix));

      const resolution = resolveGroups(config, packages.packages);

      // --target on a strict subset of a fixed group expands to the whole group so the group's
      // atomic-release invariant holds. Linked groups and ungrouped packages keep their raw targets.
      const { targets } = expandTargetsForFixedGroups(resolution, runtimeTargets);

      const targetFilter = (pkg: Package): boolean =>
        targets.length === 0 || shouldMatchPackageTargets(pkg.packageJson.name, targets);

      const allReleased: string[] = [];
      const allVersions = new Map<string, string>();

      for (const group of resolution.groups) {
        const members = group.members.filter(targetFilter).filter((p) => shouldProcess(p, config));
        if (members.length === 0) continue;

        // `config.skip` and the target filter both remove members from `members`, so a fixed group
        // can release with a subset of its declared members — leaving the group at divergent
        // versions. Warn so the divergence is intentional, not a surprise.
        if (group.sync === 'fixed') {
          const released = new Set(members.map((m) => m.packageJson.name));
          const notInRelease = group.members.map((m) => m.packageJson.name).filter((name) => !released.has(name));
          if (notInRelease.length > 0) {
            log(
              `Group "${group.name}" is fixed but will release without: ${notInRelease.join(', ')}. ` +
                'They were excluded by config.skip or --target, so the group will end up at divergent versions. ' +
                'Remove the package from config.skip (or include it via --target) to keep the group atomic.',
              'warning',
            );
          }
        }

        const plans = await Promise.all(members.map((pkg) => planMember(config, pkg, formattedPrefix, globalTag)));
        const computation = computeGroup(group, plans);

        if (!computation.hasChange) {
          log(`Group "${group.name}": no releasable changes, skipping.`, 'info');
          continue;
        }

        log(
          `Group "${group.name}" (${group.sync}): releasing ${computation.releasing.length} member(s) at ` +
            `${computation.groupVersion}.`,
          'info',
        );
        const released = releaseGroup(group, computation, config);
        for (const name of released) {
          allReleased.push(name);
          allVersions.set(name, computation.groupVersion);
        }
      }

      // Ungrouped packages version independently — same per-member machinery, no shared version.
      for (const pkg of resolution.ungrouped) {
        if (!targetFilter(pkg) || !shouldProcess(pkg, config)) continue;
        const plan = await planMember(config, pkg, formattedPrefix, globalTag);
        if (!plan.changed) continue;

        const name = pkg.packageJson.name;
        const packageJsonPath = path.join(pkg.dir, 'package.json');
        if (fs.existsSync(packageJsonPath)) {
          updatePackageVersion(packageJsonPath, plan.ownNext, config.dryRun);
        }
        const cargoTomlPath = path.join(pkg.dir, 'Cargo.toml');
        if (config.cargo?.enabled !== false && fs.existsSync(cargoTomlPath)) {
          updatePackageVersion(cargoTomlPath, plan.ownNext, config.dryRun);
        }
        const tag = formatTag(plan.ownNext, formattedPrefix, name, config.tagTemplate, config.packageSpecificTags);
        addTag(tag);
        setPackageUpdateTag(name, tag);
        const baselineTagPrefix = deriveBaselineTagPrefix(config.baselineTagTemplate, formattedPrefix, name);
        const { entries, revisionRange } = extractEntries(pkg.dir, plan.latestTag, plan.ownNext, config);
        addChangelogData({
          packageName: name,
          version: plan.ownNext,
          previousVersion: plan.latestTag ? displayTag(plan.latestTag, baselineTagPrefix, formattedPrefix) : null,
          revisionRange,
          repoUrl: readRepoUrl(pkg.dir),
          entries,
        });
        if (config.baselineTagTemplate) {
          addBaselineTag(formatTag(plan.ownNext, formattedPrefix, name, config.baselineTagTemplate, false));
        }
        allReleased.push(name);
        allVersions.set(name, plan.ownNext);
      }

      if (allReleased.length === 0) {
        log('No packages required a version update.', 'info');
        return;
      }

      // Commit message: same shape as the async strategy — combined package list, with per-package
      // versions when they diverge across groups.
      const template = config.commitMessage || 'chore: release';
      const versions = [...allVersions.values()];
      const versionsMatch = versions.every((v) => v === versions[0]);
      let commitMessage: string;
      // biome-ignore lint/suspicious/noTemplateCurlyInString: detecting placeholder syntax in user template
      if (template.includes('${version}') || template.includes('${' + 'packageName}')) {
        commitMessage = formatCommitMessage(template, versions[0], allReleased.join(', '));
      } else if (versionsMatch) {
        commitMessage = `${template} ${allReleased.join(', ')} ${formattedPrefix}${versions[0]}`;
      } else {
        commitMessage = `${template} ${allReleased.map((n) => `${n}@${allVersions.get(n)}`).join(', ')}`;
      }
      commitMessage = commitMessage.replace(/\s{2,}/g, ' ').trim();
      setCommitMessage(commitMessage);

      log(`Group versioning prepared ${allReleased.length} package(s).`, 'success');
    } catch (error) {
      if (BaseVersionError.isVersionError(error)) {
        log(`Group strategy failed: ${error.message} (${error.code})`, 'error');
      } else {
        log(`Group strategy failed: ${error instanceof Error ? error.message : String(error)}`, 'error');
      }
      throw error;
    }
  };
}
