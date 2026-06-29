import { StrictReachableError } from '../errors/strictReachableError.js';
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
  /**
   * How the repo-level shared floor (C) is bounded in package-specific-tag mode (#398). `'union'`
   * (default): each package contributes its own range, so the shared block is the union floored by
   * the oldest baseline. `'sinceLastRelease'`: every package's shared block is floored by the single
   * global nearest-reachable tag, collapsing the union so global commits don't recur.
   */
  sharedChangelogFloor?: 'union' | 'sinceLastRelease';
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
  /** `<floor>..HEAD`, floored by the package's own baseline when reachable, else by the nearest
   *  reachable tag (#370); `'HEAD'` only when the repo has no reachable tag at all (fresh repo). */
  revisionRange: string;
  /** The package's own previous version in consumer-facing display form, or `null` when its own
   *  baseline is unreachable/absent — even if the range was floored by a nearest-reachable tag, that
   *  tag is a noise floor (often another package's), not this package's predecessor, so it isn't
   *  claimed here. */
  previousVersion: string | null;
  /** True when the package's own baseline ref was resolved but unreachable (shallow clone / unpushed
   *  / synthetic) — the range was bounded by the nearest reachable tag instead. */
  baselineUnreachable: boolean;
}

/**
 * Owns the changelog-floor algorithm: the previously-divergent per-call-site logic for "which
 * `<tag>..HEAD` range a package's changelog is collected from, and is that baseline reachable" (the
 * per-package floor, B), plus the repo-level shared floor (C). B and C now bound an unreachable /
 * untagged baseline the same way — by the nearest reachable tag, never full history except in a
 * fresh repo (#370) — so neither floods. See `CONTEXT.md` for the three baseline notions; the
 * version source (A) is a separate seam.
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
      const verification = await verifyTag(baseForRange, pkgDir);
      if (verification.exists && verification.reachable) {
        revisionRange = `${baseForRange}..HEAD`;
      } else if (!baseRef && strictReachable) {
        // A dedicated type, not a bare Error: the per-package changelog try/catch in each strategy
        // degrades genuine extraction failures to a minimal entry, but must rethrow THIS so it
        // aborts the run (#372) — strictReachable's whole job is to fail loudly on an unreachable
        // baseline (shallow clone / fetch-depth), not ship a silently whole-history changelog.
        throw new StrictReachableError(
          `Cannot generate changelog: ref '${baseForRange}' is not reachable from the current commit. ` +
            `When strictReachable is enabled, all refs must be reachable. ` +
            `To allow fallback to all commits, set strictReachable to false.`,
        );
      } else if (baseRef) {
        // An unreachable `baseRef` keeps the full-history fallback: baseRef scopes the run to a PR's
        // commits, a different intent from the tag-based release floor, so the nearest-reachable tag
        // floor (#370) deliberately doesn't apply here — mirrors `sharedFloor` skipping baseRef mode.
        log(
          `Baseline ref '${baseForRange}' could not be verified from HEAD (${verification.error}) — generating ` +
            `the changelog from ALL history instead of since the last release. The ref is likely missing from the ` +
            `checkout (shallow clone, or never pushed). Fetch/push the ref to make it available in this checkout.`,
          'warning',
        );
        revisionRange = 'HEAD';
        baselineUnreachable = true;
      } else {
        // A real tag we can't reach (shallow clone / non-ancestor). Bound the range by the nearest
        // reachable tag rather than flooding with all history (#370) — the same floor `sharedFloor`
        // applies. previousVersion is still omitted (below): we diffed the nearest tag, not the
        // package's own (unreachable) baseline, so we don't claim that baseline.
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
      // No real tag — `baseForRange` is the manifest-fallback's synthetic tag, which isn't a git ref.
      // Skip verifyTag (it would emit a misleading "shallow clone" message) and bound by the nearest
      // reachable tag instead of flooding the package's own changelog with all history (#370).
      revisionRange = await this.nearestReachableRange();
      baselineUnreachable = true;
    } else {
      // No baseline at all — an untagged package with no manifest version. Still bound by the nearest
      // reachable tag (#370); a genuinely fresh repo with no tags falls through to full history.
      revisionRange = await this.nearestReachableRange();
    }

    // previousVersion is shown to users in the changelog header — strip the baseline-tag scheme back
    // to its consumer-facing form so `release/v0.22.0` appears as `v0.22.0`. On graduation with no
    // prior stable tag, `changelogBaseTag` widens to '' (so the range spans the whole prerelease
    // line) but the package's real predecessor is still its prerelease `latestTag` — fall back to it
    // for the label so a graduating package reads `<prerelease> → <stable>` instead of being
    // mislabeled a first release (#474). Kept in tag form: `generateCompareUrl` rebuilds the `to` tag
    // from it, so a bare value would break compare links. Omit it when we fell back to all-history so
    // the changelog doesn't claim a baseline it never diffed against (#339); a genuine first release
    // (no tag at all) leaves both empty and stays null.
    const previousTag = changelogBaseTag || latestTag;
    const previousVersion =
      previousTag && !baselineUnreachable
        ? displayTag(previousTag, input.baselineTagPrefix, input.formattedPrefix)
        : null;

    return { revisionRange, previousVersion, baselineUnreachable };
  }

  /**
   * Repo-level shared floor (C): the range for project-wide "shared" entries (CI, infra, shared
   * packages). `baseRef` (a PR-scoped run) is passed through unbounded.
   *
   * In `'sinceLastRelease'` mode (#398) every package's shared block is floored by the single global
   * nearest-reachable tag, so a genuinely-global commit consumed by the most recent release across
   * the repo doesn't recur in every later per-package release. In `'union'` mode (default) the
   * package's own range is used (the union across packages floors by the oldest baseline); a `'HEAD'`
   * range — only a fresh repo now that the per-package floor is itself bounded (#370) — is floored by
   * the nearest reachable tag rather than flooding with full history (#348).
   */
  async sharedFloor(perPackageRange: string): Promise<string> {
    if (this.opts.baseRef) return perPackageRange;
    if (this.opts.sharedChangelogFloor === 'sinceLastRelease') return this.nearestReachableRange();
    if (perPackageRange !== 'HEAD') return perPackageRange;
    return this.nearestReachableRange();
  }

  /**
   * The `<tag>..HEAD` range floored by the nearest tag reachable from HEAD, or `'HEAD'` when the repo
   * has no reachable tag at all. Shared by the per-package floor's fallback (B, #370) and the shared
   * floor (C, #348) so both bound the same way; computed once per run and cached.
   *
   * Uses `git describe` (prefix-agnostic, reachable by construction) — NOT the semver-tag lookup,
   * which only matches bare-semver tags and collapses to full history in per-package-tag monorepos.
   */
  private async nearestReachableRange(): Promise<string> {
    if (this.sharedBaselineRange === undefined) {
      const globalTag = await getNearestReachableTag(this.opts.sharedFloorCwd ?? process.cwd());
      this.sharedBaselineRange = globalTag ? `${globalTag}..HEAD` : 'HEAD';
    }
    return this.sharedBaselineRange;
  }
}
