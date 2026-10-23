/**
 * A fixed/linked group's version is `bump(max member baseline)` applied once, using the largest bump
 * any member earned. Members below it (never released, or an older package joining a higher family)
 * adopt it, deliberately overriding the per-package "initial version from package.json" rule.
 */

import fs from 'node:fs';
import * as path from 'node:path';
import type { Package } from '@manypkg/get-packages';
import type { VersionChangelogEntry } from '@releasekit/core';
import { shouldMatchPackageTargets, shouldProcessPackage as shouldProcessPackageUtil } from '@releasekit/core';
import type { ReleaseType } from 'semver';
import semver from 'semver';
import { extractChangelogEntriesFromCommits } from '../changelog/commitParser.js';
import { BaseVersionError } from '../errors/baseError.js';
import { StrictReachableError } from '../errors/strictReachableError.js';
import { getLatestTag, getLatestTagForPackage } from '../git/tagsAndBranches.js';
import { updatePackageVersion } from '../package/packageManagement.js';
import type { Config } from '../types.js';
import { deriveBaselineTagPrefix, formatCommitMessage, formatTag, formatVersionPrefix } from '../utils/formatting.js';
import {
  addBaselineTag,
  addChangelogData,
  addTag,
  setCommitMessage,
  setPackageUpdateAction,
  setPackageUpdateGroup,
  setPackageUpdatePreviousVersion,
  setPackageUpdateTag,
  setVersioningStrategy,
} from '../utils/jsonOutput.js';
import { log } from '../utils/logging.js';
import { resolveVersionAction } from '../utils/versionAction.js';
import { BaselineResolver } from './baselineResolver.js';
import { expandTargetsForAtomicGroups, type ResolvedGroup, resolveGroups } from './groupResolution.js';
import { calculateVersion } from './versionCalculator.js';
import type { PackagesWithRoot } from './versionEngine.js';

type ChangelogEntry = VersionChangelogEntry;

const BUMP_RANK: Record<string, number> = {
  patch: 1,
  prepatch: 1,
  minor: 2,
  preminor: 2,
  major: 3,
  premajor: 3,
  prerelease: 0,
};

/** Rank 0 is special-cased in computeGroup: `semver.inc` with a stable type would graduate the group. */
const RANK_TO_TYPE: Record<number, 'patch' | 'minor' | 'major' | 'prerelease'> = {
  0: 'prerelease',
  1: 'patch',
  2: 'minor',
  3: 'major',
};

interface MemberPlan {
  pkg: Package;
  baseline: string;
  latestTag: string;
  usedPackageSpecificTag: boolean;
  /** Version this member would bump to on its own ('' when it earned no releasable change). */
  ownNext: string;
  changed: boolean;
}

function cleanBaseline(version: string | undefined): string {
  if (!version) {
    return '0.0.0';
  }
  // Plain semver.coerce() strips the prerelease (1.0.0-next.0 -> 1.0.0), which would graduate a linked
  // or fixed group off its prerelease line on every increment.
  return (
    semver.valid(semver.clean(version) ?? '') ?? semver.coerce(version, { includePrerelease: true })?.version ?? '0.0.0'
  );
}

async function planMember(
  config: Config,
  pkg: Package,
  formattedPrefix: string,
  globalTag: string,
): Promise<MemberPlan> {
  const name = pkg.packageJson.name;

  let latestTag = '';
  let usedPackageSpecificTag = false;
  if (!config.baselineTagTemplate) {
    latestTag = await getLatestTagForPackage(name, formattedPrefix, {
      tagTemplate: config.tagTemplate,
      packageSpecificTags: config.packageSpecificTags,
    });
    usedPackageSpecificTag = !!latestTag;
  }
  if (!latestTag) {
    latestTag = globalTag;
  }

  const ownNext = await calculateVersion(config, {
    latestTag,
    versionPrefix: formattedPrefix,
    prereleaseIdentifier: config.prereleaseIdentifier,
    path: pkg.dir,
    name,
    type: config.type,
  });

  const manifestVersion = pkg.packageJson.version;
  const tagVersion = latestTag ? cleanBaseline(latestTag) : undefined;
  const candidates = [manifestVersion, tagVersion].map(cleanBaseline).filter((v) => v !== '0.0.0');
  const baseline = candidates.length > 0 ? candidates.sort(semver.rcompare)[0] : '0.0.0';

  return { pkg, baseline, latestTag, usedPackageSpecificTag, ownNext, changed: !!ownNext };
}

function memberBumpRank(plan: MemberPlan): number {
  if (!plan.changed) {
    return -1;
  }
  const diff = semver.diff(plan.baseline, plan.ownNext);
  if (!diff) {
    // Treat as a patch so the group still advances.
    return BUMP_RANK.patch;
  }
  return BUMP_RANK[diff] ?? BUMP_RANK.patch;
}

interface GroupComputation {
  /** Empty for `independent` groups, whose members each release at their own `ownNext`. */
  groupVersion: string;
  releasing: MemberPlan[];
  hasChange: boolean;
}

/** A fixed/linked group shares one version and channel, so graduating ANY member graduates the group. */
function isGroupGraduating(group: ResolvedGroup, config: Config): boolean {
  if (!config.stableOnly) {
    return false;
  }
  const scope = config.graduateScope;
  if (!scope || scope.length === 0) {
    return true;
  }
  return group.members.some((m) => shouldMatchPackageTargets(m.packageJson.name, scope));
}

/** Twin of {@link isGroupGraduating}: a single scoped member pulls the whole group onto the prerelease line. */
function isGroupPrereleasing(group: ResolvedGroup, config: Config): boolean {
  if (!config.isPrerelease) {
    return false;
  }
  const scope = config.prereleaseScope;
  if (!scope || scope.length === 0) {
    return true;
  }
  return group.members.some((m) => shouldMatchPackageTargets(m.packageJson.name, scope));
}

function computeGroup(group: ResolvedGroup, plans: MemberPlan[], config: Config): GroupComputation {
  const changedPlans = plans.filter((p) => p.changed);
  if (changedPlans.length === 0) {
    return { groupVersion: '', releasing: [], hasChange: false };
  }

  // Independent-group atomicity is enforced by target expansion and the caller's partial-subset warning.
  if (group.sync === 'independent') {
    return { groupVersion: '', releasing: changedPlans, hasChange: true };
  }

  const maxBaseline = plans.map((p) => p.baseline).sort(semver.rcompare)[0];

  // Graduation is bump-less: the group lands on the highest baseline's stable base (1.2.0-next.3 → 1.2.0).
  if (isGroupGraduating(group, config) && semver.prerelease(maxBaseline)) {
    const parsed = semver.parse(maxBaseline);
    let groupVersion = parsed ? `${parsed.major}.${parsed.minor}.${parsed.patch}` : maxBaseline;
    for (const plan of changedPlans) {
      if (semver.valid(plan.ownNext) && semver.gt(plan.ownNext, groupVersion)) {
        groupVersion = plan.ownNext;
      }
    }
    const releasing = group.sync === 'fixed' ? plans : changedPlans;
    return { groupVersion, releasing, hasChange: true };
  }
  const maxRank = Math.max(...changedPlans.map(memberBumpRank));
  const bumpType = RANK_TO_TYPE[maxRank] ?? 'patch';

  // The scoped flag is the explicit request; the member scan infers one when a member's own calculation
  // already produced a prerelease. `isGroupPrereleasing` (not raw `config.isPrerelease`) stops a
  // per-package prerelease forcing groups with no scoped member onto a prerelease line.
  const wantsPrerelease =
    isGroupPrereleasing(group, config) ||
    changedPlans.some((p) => semver.valid(p.ownNext) && semver.prerelease(p.ownNext) !== null);

  // Creating a prerelease from a stable baseline (e.g. 0.0.1 -> 1.0.0-next.0): RANK_TO_TYPE collapses
  // premajor/preminor/prepatch to a stable magnitude, so applying it directly would graduate the group,
  // and never-regress can't recover that (1.0.0-next.0 < 1.0.0).
  const creatingPrerelease = bumpType !== 'prerelease' && !semver.prerelease(maxBaseline) && wantsPrerelease;

  // Advance within an existing prerelease line (1.0.0-next.0 -> 1.0.0-next.1) - graduation requires
  // stable=true. Otherwise the published baseline is re-emitted, which never-regress can't recover when a
  // member's ownNext sits below it, for:
  //  - a spurious stable magnitude, when a member's manifest lags its prerelease tag so the backwards
  //    `semver.diff` reads as `major`; and
  //  - a prerelease rank, which the `bumpType === 'prerelease'` branch returns unchanged.
  const stayOnPrereleaseLine = !!semver.prerelease(maxBaseline) && wantsPrerelease;

  let groupVersion: string;
  if (stayOnPrereleaseLine) {
    groupVersion = config.prereleaseIdentifier
      ? (semver.inc(maxBaseline, 'prerelease', config.prereleaseIdentifier) ?? maxBaseline)
      : (semver.inc(maxBaseline, 'prerelease') ?? maxBaseline);
  } else if (bumpType === 'prerelease') {
    // Rank 0 with a *stable* max baseline (a lower member is on a prerelease line). Don't regress
    // the stable baseline; never-regress pulls the group up to the member's own prerelease next.
    groupVersion = maxBaseline;
  } else if (creatingPrerelease) {
    const preBump = `pre${bumpType}` as ReleaseType;
    groupVersion = config.prereleaseIdentifier
      ? (semver.inc(maxBaseline, preBump, config.prereleaseIdentifier) ?? maxBaseline)
      : (semver.inc(maxBaseline, preBump) ?? maxBaseline);
  } else {
    groupVersion = semver.inc(maxBaseline, bumpType) ?? maxBaseline;
  }

  // Never-regress: no member releases below its own independently-computed next version.
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

async function extractEntries(
  resolver: BaselineResolver,
  input: {
    pkgDir: string;
    latestTag: string;
    hasRealTag: boolean;
    usedPackageSpecificTag: boolean;
    nextVersion: string;
    graduationName: string;
    baselineTagPrefix: string | undefined;
    formattedPrefix: string;
    /** A fixed-group ride-along with no releasable change of its own. */
    isCarry: boolean;
  },
): Promise<{ entries: ChangelogEntry[]; revisionRange: string; previousVersion: string | null }> {
  let revisionRange = 'HEAD';
  let entries: ChangelogEntry[] = [];
  let previousVersion: string | null = null;
  try {
    const baseline = await resolver.resolve({
      pkgDir: input.pkgDir,
      latestTag: input.latestTag,
      hasRealTag: input.hasRealTag,
      usedPackageSpecificTag: input.usedPackageSpecificTag,
      nextVersion: input.nextVersion,
      graduationName: input.graduationName,
      baselineTagPrefix: input.baselineTagPrefix,
      formattedPrefix: input.formattedPrefix,
    });
    revisionRange = baseline.revisionRange;
    previousVersion = baseline.previousVersion;
    entries = await extractChangelogEntriesFromCommits(input.pkgDir, revisionRange);
  } catch (error) {
    if (error instanceof StrictReachableError) {
      throw error;
    }
    log(`Error extracting changelog entries: ${error instanceof Error ? error.message : String(error)}`, 'warning');
  }
  if (entries.length === 0) {
    // Only a carry is flagged synthetic (the preview collapses those into "Also bumped"). A changed member
    // that came back empty hit a swallowed git failure, so it stays unflagged and renders visibly.
    const fallback: ChangelogEntry = { type: 'changed', description: `Update version to ${input.nextVersion}` };
    if (input.isCarry) {
      fallback.synthetic = true;
    }
    entries = [fallback];
  }
  return { entries, revisionRange, previousVersion };
}

async function releaseGroup(
  group: ResolvedGroup,
  computation: GroupComputation,
  config: Config,
  baselineResolver: BaselineResolver,
): Promise<Array<{ name: string; version: string }>> {
  const { groupVersion, releasing } = computation;
  const formattedPrefix = formatVersionPrefix(config.versionPrefix || 'v');
  const released: Array<{ name: string; version: string }> = [];

  for (const plan of releasing) {
    const pkg = plan.pkg;
    const name = pkg.packageJson.name;
    if (!shouldProcess(pkg, config)) {
      continue;
    }

    const version = group.sync === 'independent' ? plan.ownNext : groupVersion;

    if (group.sync !== 'independent' && semver.valid(plan.baseline) && semver.lt(plan.baseline, version)) {
      const singleMajorBump = semver.inc(plan.baseline, 'major') ?? plan.baseline;
      const jumpsMoreThanOneBump = semver.gt(version, singleMajorBump);
      if (jumpsMoreThanOneBump) {
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

    const packageJsonPath = path.join(pkg.dir, 'package.json');
    if (config.npm?.enabled === false) {
      log(`Skipping package.json update for ${name} - npm version handling disabled`, 'debug');
    } else if (fs.existsSync(packageJsonPath)) {
      updatePackageVersion(packageJsonPath, version, config.dryRun);
    } else {
      log(`Skipping package.json update for ${name} - no package.json found (Rust-only package)`, 'debug');
    }

    // Default path only - `cargo.paths` doesn't apply to group members.
    const cargoTomlPath = path.join(pkg.dir, 'Cargo.toml');
    if (config.cargo?.enabled !== false && fs.existsSync(cargoTomlPath)) {
      updatePackageVersion(cargoTomlPath, version, config.dryRun);
    }

    // Always package-specific so each member's release is individually addressable.
    const tag = formatTag(version, formattedPrefix, name, config.tagTemplate, true);
    addTag(tag);
    setPackageUpdateTag(name, tag);
    setPackageUpdateGroup(name, group.name);
    const { action: memberAction, reason: memberReason } = resolveVersionAction({
      hasNoTags: plan.latestTag === '',
      latestTag: plan.latestTag,
      nextVersion: version,
    });
    setPackageUpdateAction(name, memberAction, memberReason);

    const baselineTagPrefix = deriveBaselineTagPrefix(config.baselineTagTemplate, formattedPrefix, name);
    const { entries, revisionRange, previousVersion } = await extractEntries(baselineResolver, {
      pkgDir: pkg.dir,
      latestTag: plan.latestTag,
      hasRealTag: plan.latestTag !== '',
      usedPackageSpecificTag: plan.usedPackageSpecificTag,
      nextVersion: version,
      graduationName: name,
      baselineTagPrefix,
      formattedPrefix,
      isCarry: !plan.changed,
    });
    addChangelogData({
      packageName: name,
      version,
      previousVersion,
      revisionRange,
      repoUrl: readRepoUrl(pkg.dir),
      entries,
    });
    setPackageUpdatePreviousVersion(name, previousVersion);

    if (config.baselineTagTemplate) {
      addBaselineTag(formatTag(version, formattedPrefix, name, config.baselineTagTemplate, false));
    }

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

export function createGroupStrategy(config: Config): (packages: PackagesWithRoot, targets?: string[]) => Promise<void> {
  return async (packages: PackagesWithRoot, runtimeTargets: string[] = []): Promise<void> => {
    try {
      setVersioningStrategy('group');
      const formattedPrefix = formatVersionPrefix(config.versionPrefix || 'v');
      const globalTag = await getLatestTag(deriveBaselineTagPrefix(config.baselineTagTemplate, formattedPrefix));
      const baselineResolver = new BaselineResolver({
        versionPrefix: formattedPrefix,
        tagTemplate: config.tagTemplate,
        packageSpecificTags: config.packageSpecificTags ?? false,
        strictReachable: config.strictReachable ?? false,
        baseRef: config.baseRef,
      });

      const resolution = resolveGroups(config, packages.packages);

      const { targets } = expandTargetsForAtomicGroups(resolution, runtimeTargets);

      const targetFilter = (pkg: Package): boolean =>
        targets.length === 0 || shouldMatchPackageTargets(pkg.packageJson.name, targets);

      const allReleased: string[] = [];
      const allVersions = new Map<string, string>();

      for (const group of resolution.groups) {
        const members = group.members.filter(targetFilter).filter((p) => shouldProcess(p, config));
        if (members.length === 0) {
          continue;
        }

        const plans = await Promise.all(members.map((pkg) => planMember(config, pkg, formattedPrefix, globalTag)));
        const computation = computeGroup(group, plans, config);

        if (!computation.hasChange) {
          log(`Group "${group.name}": no releasable changes, skipping.`, 'info');
          continue;
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
            const excludedPlans = await Promise.all(
              excludedMembers.map((m) => planMember(config, m, formattedPrefix, globalTag)),
            );
            droppedNames = excludedPlans.filter((p) => p.changed).map((p) => p.pkg.packageJson.name);
          }
          if (droppedNames.length > 0) {
            log(
              `Group "${group.name}" (${group.sync}) will release without: ${droppedNames.join(', ')}. ` +
                'They were excluded by config.skip or --target, so the group will not ship as a single atomic unit. ' +
                'Include them (remove from config.skip or add via --target) to keep the group atomic.',
              'warning',
            );
          }
        }

        log(
          group.sync === 'independent'
            ? `Group "${group.name}" (independent): releasing ${computation.releasing.length} member(s) on their own version lines.`
            : `Group "${group.name}" (${group.sync}): releasing ${computation.releasing.length} member(s) at ${computation.groupVersion}.`,
          'info',
        );
        const released = await releaseGroup(group, computation, config, baselineResolver);
        for (const { name, version } of released) {
          allReleased.push(name);
          allVersions.set(name, version);
        }
      }

      for (const pkg of resolution.ungrouped) {
        if (!targetFilter(pkg) || !shouldProcess(pkg, config)) {
          continue;
        }
        const plan = await planMember(config, pkg, formattedPrefix, globalTag);
        if (!plan.changed) {
          continue;
        }

        const name = pkg.packageJson.name;
        const packageJsonPath = path.join(pkg.dir, 'package.json');
        if (config.npm?.enabled !== false && fs.existsSync(packageJsonPath)) {
          updatePackageVersion(packageJsonPath, plan.ownNext, config.dryRun);
        }
        const cargoTomlPath = path.join(pkg.dir, 'Cargo.toml');
        if (config.cargo?.enabled !== false && fs.existsSync(cargoTomlPath)) {
          updatePackageVersion(cargoTomlPath, plan.ownNext, config.dryRun);
        }
        const tag = formatTag(plan.ownNext, formattedPrefix, name, config.tagTemplate, config.packageSpecificTags);
        addTag(tag);
        setPackageUpdateTag(name, tag);
        const { action: ungroupedAction, reason: ungroupedReason } = resolveVersionAction({
          hasNoTags: plan.latestTag === '',
          latestTag: plan.latestTag,
          nextVersion: plan.ownNext,
        });
        setPackageUpdateAction(name, ungroupedAction, ungroupedReason);
        const baselineTagPrefix = deriveBaselineTagPrefix(config.baselineTagTemplate, formattedPrefix, name);
        const { entries, revisionRange, previousVersion } = await extractEntries(baselineResolver, {
          pkgDir: pkg.dir,
          latestTag: plan.latestTag,
          hasRealTag: plan.latestTag !== '',
          usedPackageSpecificTag: plan.usedPackageSpecificTag,
          nextVersion: plan.ownNext,
          graduationName: name,
          baselineTagPrefix,
          formattedPrefix,
          isCarry: false,
        });
        addChangelogData({
          packageName: name,
          version: plan.ownNext,
          previousVersion,
          revisionRange,
          repoUrl: readRepoUrl(pkg.dir),
          entries,
        });
        setPackageUpdatePreviousVersion(name, previousVersion);
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
