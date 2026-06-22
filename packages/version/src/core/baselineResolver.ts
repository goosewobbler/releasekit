import { getLatestStableTag, getLatestStableTagForPackage, getNearestReachableTag } from '../git/tagsAndBranches.js';
import { verifyTag } from '../git/tagVerification.js';
import { displayTag } from '../utils/formatting.js';
import { log } from '../utils/logging.js';
import { isStableTag, isStableVersion } from '../utils/versionUtils.js';

/**
 * Per-run configuration for {@link BaselineResolver}. Mirrors the slice of version config the
 * floor algorithm reads — held once so the shared floor (C) is computed a single time per run.
 */
export interface BaselineResolverOptions {
  /** Consumer-facing version prefix, already normalised via `formatVersionPrefix` (e.g. `v`). */
  versionPrefix: string;
  /** Per-package tag template — used by the graduation stable-tag lookup in the package-specific series. */
  tagTemplate?: string;
  packageSpecificTags: boolean;
  strictReachable: boolean;
  /**
   * Advisory standing-PR base SHA. When set it overrides the floor and is treated as always
   * intended — verification failures still bound the range rather than throwing under strictReachable.
   */
  baseRef?: string;
  /** CWD for the repo-level nearest-reachable floor lookup (shared floor). Defaults to `process.cwd()`. */
  sharedFloorCwd?: string;
}

/**
 * Per-package facts the caller has already discovered (tag lookup is shared with version calculation,
 * so the resolver receives the result rather than re-running discovery).
 */
export interface BaselineInput {
  /** Directory to run git from — the package dir, or the changelog root in sync mode. */
  pkgDir: string;
  /** The package's discovered latest tag, or `''` when none. */
  latestTag: string;
  /** Whether `latestTag` is a real git tag (vs. a manifest-fallback synthetic tag, or empty). */
  hasRealTag: boolean;
  /** Whether `latestTag` came from the package-specific series — decides which stable-tag lookup graduation uses. */
  usedPackageSpecificTag: boolean;
  /** The version being released — drives the prerelease→stable graduation floor. */
  nextVersion: string;
  /** Package name for the graduation stable-tag lookup (package-specific series). */
  graduationName?: string;
  /** Caller-derived baseline-tag prefix (`deriveBaselineTagPrefix`) for display-stripping `previousVersion`. */
  baselineTagPrefix: string | undefined;
  /** Caller-derived consumer prefix (`formatVersionPrefix` output) for display. */
  formattedPrefix: string;
}

export interface PackageBaseline {
  /** `<floor>..HEAD`, or `'HEAD'` when there is no reachable baseline. */
  revisionRange: string;
  /** The floor tag in consumer-facing display form, or `null` when the baseline is unreachable/absent. */
  previousVersion: string | null;
  /** True when a baseline ref was resolved but is unreachable (shallow clone / unpushed / synthetic). */
  baselineUnreachable: boolean;
}

/**
 * Owns the changelog-floor algorithm: the previously-divergent per-call-site logic for "which
 * `<tag>..HEAD` range a package's changelog is collected from, and is that baseline reachable" (the
 * per-package floor, B), plus the repo-level shared floor (C). See `CONTEXT.md` for the three
 * baseline notions; the version source (A) is a separate seam.
 *
 * Constructed once per version run so the shared floor is computed a single time and reused across
 * packages. Receives already-discovered tag facts; does not re-run tag discovery.
 *
 * Consolidates the copies in `createSyncStrategy`, `createSingleStrategy`, `groupStrategy`, and
 * `PackageProcessor`. Only the async path previously had the merge-base reachability check (#339)
 * and the graduation-since-stable floor; this is now the single behaviour for every mode.
 */
export class BaselineResolver {
  /** Lazy per-run cache for the repo-level shared floor (C). */
  private sharedBaselineRange: string | undefined;

  constructor(private readonly opts: BaselineResolverOptions) {}

  /**
   * Resolve the per-package changelog floor (B): the revision range, the display-form previous
   * version, and whether the baseline turned out to be unreachable.
   */
  async resolve(input: BaselineInput): Promise<PackageBaseline> {
    const { pkgDir, latestTag, hasRealTag, usedPackageSpecificTag, nextVersion, graduationName } = input;
    const { baseRef, strictReachable, versionPrefix, tagTemplate } = this.opts;

    // Graduation: when a prerelease graduates to stable, aggregate the changelog from the last
    // *stable* tag rather than from `latestTag` (the prerelease, which usually holds only the
    // release-prep commit). `latestTag` still drives version calculation upstream — it must see the
    // prerelease to graduate correctly. With no prior stable tag, this stays `''` and the range
    // falls through to all commits.
    let changelogBaseTag = latestTag;
    if (hasRealTag && latestTag && isStableVersion(nextVersion) && !isStableTag(latestTag)) {
      // Follow latestTag's source (package series vs global) — the other lookup returns '' here and
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
    // baseRef (a PR base SHA supplied in advisory standing-pr mode) takes precedence — it scopes the
    // changelog to only this PR's commits, not all commits since the last tag.
    const baseForRange = baseRef ?? changelogBaseTag;

    if (baseForRange && (baseRef || hasRealTag)) {
      // A real tag (or explicit baseRef): verify it. Existence alone isn't enough — a tag from a
      // shallow clone or a non-ancestor branch can `rev-parse` but produce a meaningless range, so
      // require ancestry (#339).
      const verification = verifyTag(baseForRange, pkgDir);
      if (verification.exists && verification.reachable) {
        revisionRange = `${baseForRange}..HEAD`;
      } else {
        if (!baseRef && strictReachable) {
          throw new Error(
            `Cannot generate changelog: ref '${baseForRange}' is not reachable from the current commit. ` +
              `When strictReachable is enabled, all refs must be reachable. ` +
              `To allow fallback to all commits, set strictReachable to false.`,
          );
        }
        // Loud, not debug: this silently produces a whole-history changelog (#339). Callers omit
        // previousVersion when this fires (below) so the changelog doesn't claim an undiffed baseline.
        log(
          `Baseline ref '${baseForRange}' could not be verified from HEAD (${verification.error}) — generating ` +
            `the changelog from ALL history instead of since the last release. The ref is likely missing from the ` +
            `checkout (shallow clone, or never pushed). ${
              baseRef
                ? 'Fetch/push the ref to make it available in this checkout.'
                : 'Fetch/push the tag, or set version.baseRef, to bound it.'
            }`,
          'warning',
        );
        revisionRange = 'HEAD';
        baselineUnreachable = true;
      }
    } else if (baseForRange) {
      // No real tag — `baseForRange` is the manifest-fallback's synthetic tag, which isn't a git ref.
      // The caller's untagged warning (#334) already explained the full-history changelog accurately,
      // so skip verifyTag: it would emit a second, misleading "shallow clone / unpushed" message.
      revisionRange = 'HEAD';
      baselineUnreachable = true;
    }

    // previousVersion is shown to users in the changelog header — strip the baseline-tag scheme back
    // to its consumer-facing form so `release/v0.22.0` appears as `v0.22.0`. Omit it when we fell
    // back to all-history so the changelog doesn't claim a baseline it never diffed against (#339).
    const previousVersion =
      changelogBaseTag && !baselineUnreachable
        ? displayTag(changelogBaseTag, input.baselineTagPrefix, input.formattedPrefix)
        : null;

    return { revisionRange, previousVersion, baselineUnreachable };
  }

  /**
   * Repo-level shared floor (C): the range for project-wide "shared" entries (CI, infra, shared
   * packages). For a package whose own range collapsed to `'HEAD'` (untagged, or tag unreachable,
   * with no baseRef), bound it by the most recent tag reachable from HEAD rather than flooding the
   * shared section with full history (#348). Computed once per run and reused.
   *
   * Uses `git describe` (prefix-agnostic, reachable by construction) — NOT the semver-tag lookup,
   * which only matches bare-semver tags and collapses to full history in per-package-tag monorepos.
   */
  sharedFloor(perPackageRange: string): string {
    if (perPackageRange !== 'HEAD' || this.opts.baseRef) return perPackageRange;
    if (this.sharedBaselineRange === undefined) {
      const globalTag = getNearestReachableTag(this.opts.sharedFloorCwd ?? process.cwd());
      this.sharedBaselineRange = globalTag ? `${globalTag}..HEAD` : 'HEAD';
    }
    return this.sharedBaselineRange;
  }
}
