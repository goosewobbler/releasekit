import { StrictReachableError } from '../errors/strictReachableError.js';
import { getLatestStableTag, getLatestStableTagForPackage, getNearestReachableTag } from '../git/tagsAndBranches.js';
import { verifyTag } from '../git/tagVerification.js';
import { displayTag } from '../utils/formatting.js';
import { log } from '../utils/logging.js';
import { isStableTag, isStableVersion } from '../utils/versionUtils.js';

export interface BaselineResolverOptions {
  /** Already normalised via `formatVersionPrefix`. */
  versionPrefix: string;
  /** Used by the graduation stable-tag lookup in the package-specific series. */
  tagTemplate?: string;
  packageSpecificTags: boolean;
  strictReachable: boolean;
  /** Advisory standing-PR base SHA. Overrides the floor and never throws under strictReachable. */
  baseRef?: string;
  sharedFloorCwd?: string;
  /**
   * How the shared floor (C) is bounded in package-specific-tag mode. `'union'`: each package
   * contributes its own range, so the shared block is the union floored by the oldest baseline.
   * `'sinceLastRelease'`: every package's shared block is floored by the single global
   * nearest-reachable tag, so global commits don't recur.
   */
  sharedChangelogFloor?: 'union' | 'sinceLastRelease';
}

/** Tag facts the caller already discovered for version calculation; the resolver doesn't re-run discovery. */
export interface BaselineInput {
  /** Directory to run git from - the package dir, or the changelog root in sync mode. */
  pkgDir: string;
  latestTag: string;
  /** Whether `latestTag` is a real git tag (vs. a manifest-fallback synthetic tag, or empty). */
  hasRealTag: boolean;
  usedPackageSpecificTag: boolean;
  /** Drives the prerelease→stable graduation floor. */
  nextVersion: string;
  /** Package name for the graduation stable-tag lookup (package-specific series). */
  graduationName?: string;
  /** Caller-derived baseline-tag prefix (`deriveBaselineTagPrefix`) for display-stripping `previousVersion`. */
  baselineTagPrefix: string | undefined;
  /** Caller-derived consumer prefix (`formatVersionPrefix` output) for display. */
  formattedPrefix: string;
}

export interface PackageBaseline {
  /** `<floor>..HEAD`, floored by the package's own baseline when reachable, else by the nearest
   *  reachable tag; `'HEAD'` only when the repo has no reachable tag at all (fresh repo). */
  revisionRange: string;
  /** `null` when the package's own baseline is unreachable/absent - a nearest-reachable floor tag is
   *  noise (often another package's), not this package's predecessor, so it isn't claimed. */
  previousVersion: string | null;
  /** The package's own baseline ref was unreachable (shallow clone / unpushed / synthetic). */
  baselineUnreachable: boolean;
}

/**
 * Owns the changelog floor: which `<tag>..HEAD` range a package's changelog is collected from and
 * whether that baseline is reachable (the per-package floor, B), plus the repo-level shared floor (C).
 * Both bound an unreachable or untagged baseline by the nearest reachable tag - never full history
 * except in a fresh repo. See `CONTEXT.md` for the three baseline notions.
 *
 * Constructed once per version run so the shared floor is computed once and reused across packages.
 */
export class BaselineResolver {
  private sharedBaselineRange: string | undefined;

  constructor(private readonly opts: BaselineResolverOptions) {}

  async resolve(input: BaselineInput): Promise<PackageBaseline> {
    const { pkgDir, latestTag, hasRealTag, usedPackageSpecificTag, nextVersion, graduationName } = input;
    const { baseRef, strictReachable, versionPrefix, tagTemplate } = this.opts;

    // On graduation, aggregate the changelog from the last *stable* tag, not the prerelease `latestTag`
    // (which usually holds only the release-prep commit).
    let changelogBaseTag = latestTag;
    if (hasRealTag && latestTag && isStableVersion(nextVersion) && !isStableTag(latestTag)) {
      // Follow latestTag's source (package series vs global) - the other lookup returns '' here and
      // would over-include every commit.
      changelogBaseTag =
        usedPackageSpecificTag && graduationName
          ? await getLatestStableTagForPackage(graduationName, versionPrefix, {
              tagTemplate,
              packageSpecificTags: true,
            })
          : await getLatestStableTag(versionPrefix);
    }

    let revisionRange = 'HEAD';
    let baselineUnreachable = false;
    const baseForRange = baseRef ?? changelogBaseTag;

    if (baseForRange && (baseRef || hasRealTag)) {
      const verification = await verifyTag(baseForRange, pkgDir);
      if (verification.exists && verification.reachable) {
        revisionRange = `${baseForRange}..HEAD`;
      } else if (!baseRef && strictReachable) {
        throw new StrictReachableError(
          `Cannot generate changelog: ref '${baseForRange}' is not reachable from the current commit. ` +
            `When strictReachable is enabled, all refs must be reachable. ` +
            `To allow fallback to all commits, set strictReachable to false.`,
        );
      } else if (baseRef) {
        // baseRef scopes a PR, not a release, so the nearest-reachable floor doesn't apply (as in
        // `sharedFloor`) and an unreachable one falls back to full history.
        log(
          `Baseline ref '${baseForRange}' could not be verified from HEAD (${verification.error}) — generating ` +
            `the changelog from ALL history instead of since the last release. The ref is likely missing from the ` +
            `checkout (shallow clone, or never pushed). Fetch/push the ref to make it available in this checkout.`,
          'warning',
        );
        revisionRange = 'HEAD';
        baselineUnreachable = true;
      } else {
        revisionRange = await this.nearestReachableRange();
        baselineUnreachable = true;
        log(
          revisionRange === 'HEAD'
            ? `Baseline ref '${baseForRange}' could not be verified from HEAD (${verification.error}), and no ` +
                `other reachable tag exists — generating the changelog from ALL history. The ref is likely missing ` +
                `(shallow clone, or never pushed); fetch/push the tag, or set version.baseRef, to bound it.`
            : `Baseline ref '${baseForRange}' could not be verified from HEAD (${verification.error}) — bounding the ` +
                `changelog by the nearest reachable tag instead of the declared baseline. The ref is likely missing ` +
                `(shallow clone, or never pushed); fetch/push the tag, or set version.baseRef, to bound it precisely.`,
          'warning',
        );
      }
    } else if (baseForRange) {
      // A manifest-fallback synthetic tag isn't a git ref; verifyTag would emit a misleading
      // "shallow clone" message.
      revisionRange = await this.nearestReachableRange();
      baselineUnreachable = true;
    } else {
      revisionRange = await this.nearestReachableRange();
    }

    // On graduation with no prior stable tag changelogBaseTag is '', but the real predecessor is still the
    // prerelease latestTag - label from it rather than call this a first release. Kept in tag form:
    // `generateCompareUrl` rebuilds the `to` tag from it.
    const previousTag = changelogBaseTag || latestTag;
    const previousVersion =
      previousTag && !baselineUnreachable
        ? displayTag(previousTag, input.baselineTagPrefix, input.formattedPrefix)
        : null;

    return { revisionRange, previousVersion, baselineUnreachable };
  }

  /** Repo-level shared floor (C): the range for project-wide "shared" entries (CI, infra, shared packages). */
  async sharedFloor(perPackageRange: string): Promise<string> {
    if (this.opts.baseRef) {
      return perPackageRange;
    }
    if (this.opts.sharedChangelogFloor === 'sinceLastRelease') {
      return this.nearestReachableRange();
    }
    if (perPackageRange !== 'HEAD') {
      return perPackageRange;
    }
    return this.nearestReachableRange();
  }

  private async nearestReachableRange(): Promise<string> {
    if (this.sharedBaselineRange === undefined) {
      const globalTag = await getNearestReachableTag(this.opts.sharedFloorCwd ?? process.cwd());
      this.sharedBaselineRange = globalTag ? `${globalTag}..HEAD` : 'HEAD';
    }
    return this.sharedBaselineRange;
  }
}
