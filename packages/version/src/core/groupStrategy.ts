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

/** Aggregate-bump type for a group rank. Rank 0 is "prerelease-increment" — a special case handled in computeGroup because `semver.inc` with a stable release type would graduate the group to a stable release. */
const RANK_TO_TYPE: Record<number, 'patch' | 'minor' | 'major' | 'prerelease'> = {
  0: 'prerelease',
  1: 'patch',
  2: 'minor',
  3: 'major',
};

interface MemberPlan {
  pkg: Package;
  /** Resolved current version (baseline) for this member. */
  baseline: string;
  /** The tag the changelog/revision range is computed against, or '' when none. */
  latestTag: string;
  /** Whether `latestTag` came from this package's own series (vs. the global fallback). */
  usedPackageSpecificTag: boolean;
  /** Version this member would bump to on its own ('' when it earned no releasable change). */
  ownNext: string;
  /** Whether this member earned a releasable change. */
  changed: boolean;
}

function cleanBaseline(version: string | undefined): string {
  if (!version) return '0.0.0';
  // semver.coerce() strips the prerelease (1.0.0-next.0 -> 1.0.0), which would graduate a linked or
  // fixed group off its prerelease line on every increment. Parse prerelease-preserving first:
  // clean() for a bare semver, then coerce({ includePrerelease }) only to pull it from a tag prefix.
  return (
    semver.valid(semver.clean(version) ?? '') ?? semver.coerce(version, { includePrerelease: true })?.version ?? '0.0.0'
  );
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
  let usedPackageSpecificTag = false;
  if (!config.baselineTagTemplate) {
    latestTag = await getLatestTagForPackage(name, formattedPrefix, {
      tagTemplate: config.tagTemplate,
      packageSpecificTags: config.packageSpecificTags,
    });
    usedPackageSpecificTag = !!latestTag;
  }
  if (!latestTag) latestTag = globalTag;

  const ownNext = await calculateVersion(config, {
    latestTag,
    versionPrefix: formattedPrefix,
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

  return { pkg, baseline, latestTag, usedPackageSpecificTag, ownNext, changed: !!ownNext };
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

interface GroupComputation {
  /** The shared version every releasing member is written to. Empty for `independent` groups, whose
   *  members each release at their own `MemberPlan.ownNext`. */
  groupVersion: string;
  /** Members that will be released (all members for fixed; changed members for linked/independent). */
  releasing: MemberPlan[];
  /** Whether the group has any releasable change at all. */
  hasChange: boolean;
}

/**
 * Compute the group version and the set of releasing members from each member's independent plan.
 */
function computeGroup(group: ResolvedGroup, plans: MemberPlan[], config: Config): GroupComputation {
  const changedPlans = plans.filter((p) => p.changed);
  if (changedPlans.length === 0) {
    return { groupVersion: '', releasing: [], hasChange: false };
  }

  // Independent groups have no shared version — each changed member releases on its own
  // commit-driven line. Only changed members release; atomicity is enforced by target expansion
  // (the whole group is pulled in) and the partial-subset warning in the caller.
  if (group.sync === 'independent') {
    return { groupVersion: '', releasing: changedPlans, hasChange: true };
  }

  const maxBaseline = plans.map((p) => p.baseline).sort(semver.rcompare)[0];
  const maxRank = Math.max(...changedPlans.map(memberBumpRank));
  const bumpType = RANK_TO_TYPE[maxRank] ?? 'patch';

  // A member can be *creating* a prerelease from a stable baseline (premajor/preminor/prepatch —
  // e.g. 0.0.1 -> 1.0.0-next.0). RANK_TO_TYPE collapses those to a stable major/minor/patch
  // magnitude, so applying the aggregate directly would graduate the group to a stable release,
  // and the never-regress guard below can't recover it (1.0.0-next.0 < 1.0.0 in semver). Detect
  // that and apply the pre-variant + identifier so the group stays on the prerelease line.
  //
  // Two signals, by design: `config.isPrerelease` is the explicit, authoritative request (the user
  // passed --prerelease / the prerelease channel) — when set, the group belongs on the prerelease
  // line regardless of per-member magnitudes. The member-scan is the inference fallback for when the
  // flag isn't set globally but a member's own calculation already produced a prerelease.
  const creatingPrerelease =
    bumpType !== 'prerelease' &&
    !semver.prerelease(maxBaseline) &&
    (config.isPrerelease || changedPlans.some((p) => semver.valid(p.ownNext) && semver.prerelease(p.ownNext) !== null));

  // Apply the aggregate bump once to the highest baseline in the group. For prerelease rank
  // (all changed members are on a prerelease family), pass the identifier so semver.inc
  // increments within the prerelease instead of graduating to a stable release. Members whose
  // own bump already produced a higher version still pull the group version up via the
  // never-regress guard below.
  let groupVersion: string;
  if (bumpType === 'prerelease') {
    groupVersion = config.prereleaseIdentifier
      ? (semver.inc(maxBaseline, 'prerelease', config.prereleaseIdentifier) ?? maxBaseline)
      : maxBaseline;
  } else if (creatingPrerelease) {
    const preBump = `pre${bumpType}` as ReleaseType;
    groupVersion = config.prereleaseIdentifier
      ? (semver.inc(maxBaseline, preBump, config.prereleaseIdentifier) ?? maxBaseline)
      : (semver.inc(maxBaseline, preBump) ?? maxBaseline);
  } else {
    groupVersion = semver.inc(maxBaseline, bumpType) ?? maxBaseline;
  }

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
  },
): Promise<{ entries: ChangelogEntry[]; revisionRange: string; previousVersion: string | null }> {
  let revisionRange = 'HEAD';
  let entries: ChangelogEntry[] = [];
  let previousVersion: string | null = null;
  let extractionFailed = false;
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
    // A strictReachable violation must abort the run, not degrade to a minimal entry (#372).
    if (error instanceof StrictReachableError) throw error;
    log(`Error extracting changelog entries: ${error instanceof Error ? error.message : String(error)}`, 'warning');
    extractionFailed = true;
  }
  if (entries.length === 0) {
    // A clean empty extraction is a genuine lockstep carry — a group member bumped to stay in sync
    // with no commits of its own. Flag it synthetic so the preview collapses it into "Also bumped"
    // rather than a full "Update version to X" block (#468). An extraction *failure* is not the same
    // as "no changes": leave it unflagged so the bump still renders a visible block instead of
    // vanishing as a no-change carry (#469).
    const fallback: ChangelogEntry = { type: 'changed', description: `Update version to ${input.nextVersion}` };
    if (!extractionFailed) fallback.synthetic = true;
    entries = [fallback];
  }
  return { entries, revisionRange, previousVersion };
}

/**
 * Release one group: write the group version to every releasing member, emit per-package tags +
 * changelog data, and tag each update with the group name for downstream CI surfaces.
 * Returns the names of the packages that were written (for commit-message aggregation).
 */
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
    if (!shouldProcess(pkg, config)) continue;

    // Independent members release on their own commit-driven line; fixed/linked members adopt the
    // shared group version.
    const version = group.sync === 'independent' ? plan.ownNext : groupVersion;

    // Adoption (fixed/linked only): a member below the shared group version jumps to it. Warn loudly
    // when the jump skips versions — i.e. the group version is strictly beyond what a single major
    // bump of this member would have produced — so adopters time the migration to a real breaking
    // change. An unchanged member that is nonetheless released (fixed group) is the routine lockstep
    // case: just log it at info level, since it doesn't skip any versions for that member.
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
    if (fs.existsSync(packageJsonPath)) {
      updatePackageVersion(packageJsonPath, version, config.dryRun);
    } else {
      log(`Skipping package.json update for ${name} - no package.json found (Rust-only package)`, 'debug');
    }

    // Cargo handled the same way as other strategies (default path only — paths config applies
    // to single/async; group members are package-keyed).
    const cargoTomlPath = path.join(pkg.dir, 'Cargo.toml');
    if (config.cargo?.enabled !== false && fs.existsSync(cargoTomlPath)) {
      updatePackageVersion(cargoTomlPath, version, config.dryRun);
    }

    // Per-package tag + changelog. Group members always get package-specific tags so each
    // member's release is individually addressable (the group acts atomically at the version level,
    // not the tag level).
    const tag = formatTag(version, formattedPrefix, name, config.tagTemplate, true);
    addTag(tag);
    setPackageUpdateTag(name, tag);
    setPackageUpdateGroup(name, group.name);
    // Resolved version action (#420), derived from the member's own tag facts and the version it
    // actually resolved to (group version for fixed/linked, own line for independent).
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
    });
    addChangelogData({
      packageName: name,
      version,
      previousVersion,
      revisionRange,
      repoUrl: readRepoUrl(pkg.dir),
      entries,
    });

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
      const baselineResolver = new BaselineResolver({
        versionPrefix: formattedPrefix,
        tagTemplate: config.tagTemplate,
        packageSpecificTags: config.packageSpecificTags ?? false,
        strictReachable: config.strictReachable ?? false,
        baseRef: config.baseRef,
      });

      const resolution = resolveGroups(config, packages.packages);

      // --target on a strict subset of an atomic group (fixed or independent) expands to the whole
      // group so its atomic-release invariant holds. Linked groups and ungrouped packages keep their
      // raw targets.
      const { targets } = expandTargetsForAtomicGroups(resolution, runtimeTargets);

      const targetFilter = (pkg: Package): boolean =>
        targets.length === 0 || shouldMatchPackageTargets(pkg.packageJson.name, targets);

      const allReleased: string[] = [];
      const allVersions = new Map<string, string>();

      for (const group of resolution.groups) {
        const members = group.members.filter(targetFilter).filter((p) => shouldProcess(p, config));
        if (members.length === 0) continue;

        const plans = await Promise.all(members.map((pkg) => planMember(config, pkg, formattedPrefix, globalTag)));
        const computation = computeGroup(group, plans, config);

        if (!computation.hasChange) {
          log(`Group "${group.name}": no releasable changes, skipping.`, 'info');
          continue;
        }

        // `config.skip` and the target filter remove members from `members`, so an atomic group can
        // ship a partial set. fixed loses lockstep if ANY declared member is missing; independent only
        // breaks if a *changed* member is missing — an unchanged skipped member would not release
        // anyway, so we plan the excluded members to avoid a false alarm. Linked groups release
        // partially by design, so they're exempt.
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
        // Resolved version action (#420) for an independently-versioned ungrouped package.
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
        });
        addChangelogData({
          packageName: name,
          version: plan.ownNext,
          previousVersion,
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
