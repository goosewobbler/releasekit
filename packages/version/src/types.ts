import type { VersionConfig, VersionGroup } from '@releasekit/config';
import type { ReleaseType } from 'semver';

/**
 * A version group as carried through the version engine.
 * `name` is the config key; `packages` are the raw patterns; `sync` is the group's mode.
 */
export interface VersionGroupConfig extends VersionGroup {
  name: string;
}

/**
 * Runtime overrides passed by an orchestrator (e.g. @releasekit/release).
 * These are separate from file-loaded Config so the engine never mutates the
 * caller's config object.
 */
export interface VersionRunOptions {
  /** Force a specific bump type (equivalent to --bump). */
  bump?: ReleaseType;
  /** Create a prerelease version. Pass a string to override the identifier (e.g. 'beta'),
   *  or true to use the configured identifier (with 'next' as fallback if none is configured). */
  prerelease?: string | boolean;
  /** Graduate prerelease packages to stable; skip already-stable packages
   *  unless bump is also set, in which case bump applies to stable packages. */
  stable?: boolean;
  /**
   * Per-package graduation (#486): package name patterns to graduate to stable on this run, leaving
   * every other prerelease package on its own line. Drives `stableOnly` scoped to just these packages
   * (see {@link Config.graduateScope}). Distinct from the global `stable` flag, which graduates ALL
   * prereleases. When both are set, `stable` wins (graduate everything). Empty/undefined → no
   * per-package graduation.
   */
  graduate?: string[];
  /** Acknowledge a first-release bump on a stable manifest, silencing the #388 overshoot guard. */
  allowFirstBump?: boolean;
  dryRun?: boolean;
  sync?: boolean;
  /** Limit release to these package name patterns (comma-split targets from CLI). */
  targets?: string[];
  /**
   * When set, use this commit SHA as the start of the revision range instead of the last release
   * tag. Scopes both the bump-type calculation and the changelog to commits after this ref.
   * Useful for preview mode where only a PR's own commits should be analysed.
   */
  baseRef?: string;
  /**
   * Package name patterns the `bump` / `prerelease` / `stable` override applies to. When set, only
   * matching packages receive the override; the rest fall through to commit-driven calculation.
   * `undefined` (the default) applies the override to every package.
   */
  overrideScope?: string[];
  /**
   * Expand the explicit `targets` to also release their changed transitive dependencies
   * (prerequisites) plus the rest of any group a target belongs to. The override (bump/prerelease/
   * stable) stays scoped to the explicit, group-expanded targets; prerequisites keep their own
   * commit-driven bump.
   */
  includePrerequisites?: boolean;
  /**
   * Package names to drop from the release set, applied as the final discovery filter — after
   * `targets`, `packages`, and prerequisite expansion. An excluded package is never bumped, so its
   * `package.json` is untouched and it produces no update. Used by standing-PR ad-hoc selection: a
   * maintainer unchecks a package and it falls out of the release entirely (no orphan bump landing
   * on the base branch with no tag). Exact name match, not a pattern.
   */
  exclude?: string[];
}

export interface GitInfo {
  currentBranch: string;
  mergeBranch?: string;
}

export interface VersionConfigBase {
  versionPrefix: string;
  type?: ReleaseType;
  prereleaseIdentifier?: string;
  path?: string;
  /** Override the directory used for commit-count checks. When set, commit counting
   *  uses this path instead of `path`. Useful in sync mode where the version is read
   *  from a workspace package but commits should be counted against the repo root. */
  commitCheckPath?: string;
  name?: string;
  strictReachable?: boolean;
}

export interface Config extends VersionConfigBase {
  tagTemplate: string;
  /** Optional secondary tag template for an internal "baseline" marker that records the
   *  release commit on the source branch. Lives alongside the tag from `tagTemplate`. Used
   *  when the primary tag gets force-moved off the source branch by a downstream step (e.g.
   *  an action-dist build) — version-bump and changelog logic reads the baseline tag instead.
   *  Supports the same `${packageName}` / `${prefix}` / `${version}` substitutions. */
  baselineTagTemplate?: string;
  packageSpecificTags?: boolean;
  preset: string;
  sync: boolean;
  /**
   * Named version groups, each with package patterns and a `fixed` | `linked` sync mode.
   * `sync: true` is normalized into one implicit `fixed` group of every package at runtime, so
   * groups are the single mechanism for lockstep/linked versioning. See groupResolution.ts.
   */
  groups?: Record<string, VersionGroup>;
  packages: string[];
  /** Foundational packages whose changes route to repo-level ("Project-wide changes") in every
   *  package's changelog (exact name or glob). See VersionConfig.sharedPackages. Default: none. */
  sharedPackages?: string[];
  /** How the repo-level ("Project-wide changes") block is floored in package-specific-tag mode.
   *  'union' (default): the union of releasing packages' ranges, floored by the oldest baseline.
   *  'sinceLastRelease': the single global nearest-reachable tag, so global commits don't recur.
   *  See VersionConfig.sharedChangelogFloor. */
  sharedChangelogFloor?: 'union' | 'sinceLastRelease';
  mainPackage?: string;
  skip?: string[];
  /** Include npm packages marked `"private": true` in package.json in the release flow. Default
   *  false: private packages are skipped at discovery (they can't be published), mirroring the
   *  Cargo `publish = false` / pub `publish_to: none` skips. See VersionConfig.includePrivate. */
  includePrivate?: boolean;
  commitMessage?: string;
  dryRun?: boolean;
  latestTag?: string;
  isPrerelease?: boolean;
  stableOnly?: boolean;
  /** Runtime override: when set, use this commit SHA as the start of the revision range
   *  for both bump calculation and changelog extraction. See VersionRunOptions.baseRef. */
  baseRef?: string;
  /** Runtime override: package patterns the forced bump/prerelease/stable applies to. When set,
   *  non-matching packages ignore the override and compute commit-driven. See VersionRunOptions.overrideScope. */
  overrideScope?: string[];
  /** Runtime override (#486): package patterns to graduate to stable. Set together with `stableOnly`
   *  by per-package graduation; a package outside this scope keeps `stableOnly` cleared and advances
   *  along its own line. `undefined`/empty with `stableOnly` set means "graduate every prerelease"
   *  (the global `release:graduate` path). See VersionRunOptions.graduate. */
  graduateScope?: string[];
  /** Runtime (engine-populated): the FULL discovered workspace — every package's name+dir, before
   *  the release-set filters (targets/exclude/config.packages). The repo-level changelog classifier
   *  uses this so a commit touching a non-releasing package's dir is attributed to that package, not
   *  leaked into "Project-wide changes" (#397). Not user config. */
  allWorkspacePackages?: Array<{ name: string; dir: string }>;
  mismatchStrategy?: 'error' | 'warn' | 'ignore' | 'prefer-package' | 'prefer-git';
  /** Acknowledge a first-release bump on an already-stable manifest, silencing the #388 overshoot
   *  guard (which otherwise warns, or aborts under mismatchStrategy 'error'). See VersionConfig.allowFirstBump. */
  allowFirstBump?: boolean;
  strictReachable?: boolean;
  /** Pre-1.0 inferred-breaking bump policy ('spec' | 'strict'). See docs/configuration.md#versionzeromajor. */
  zeroMajor?: 'spec' | 'strict';
  cargo?: {
    enabled?: boolean;
    paths?: string[];
  };
  pub?: {
    enabled?: boolean;
    paths?: string[];
  };
}

export type PkgJson = {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  path?: string;
};

export interface TagFormat {
  tagTemplate?: string;
  prefix?: string;
  name?: string;
  sync: boolean;
}

export interface TagProps {
  prefix: string;
  version: string;
  packageName?: string;
}

export interface VersionOptions extends VersionConfigBase {
  latestTag: string;
  hasRealTag?: boolean;
}

export interface GitProcess {
  files: string[];
  nextTag: string;
  commitMessage: string;
  dryRun?: boolean;
}

export interface PackageVersion {
  path: string;
  version: string;
  name: string;
  dryRun?: boolean;
}

export function toVersionConfig(config: VersionConfig | undefined): Config {
  if (!config) {
    return {
      tagTemplate: 'v{version}',
      packageSpecificTags: false,
      preset: 'conventional',
      sync: true,
      packages: [],
      versionPrefix: '',
    };
  }

  return {
    tagTemplate: config.tagTemplate ?? 'v{version}',
    baselineTagTemplate: config.baselineTagTemplate,
    packageSpecificTags: config.packageSpecificTags,
    preset: config.preset ?? 'conventional',
    sync: config.sync ?? true,
    groups: config.groups,
    packages: config.packages ?? [],
    sharedPackages: config.sharedPackages,
    sharedChangelogFloor: config.sharedChangelogFloor,
    mainPackage: config.mainPackage,
    skip: config.skip,
    includePrivate: config.includePrivate,
    commitMessage: config.commitMessage,
    mismatchStrategy: config.mismatchStrategy,
    allowFirstBump: config.allowFirstBump,
    zeroMajor: config.zeroMajor,
    versionPrefix: config.versionPrefix ?? '',
    prereleaseIdentifier: config.prereleaseIdentifier,
    cargo: config.cargo,
    pub: config.pub,
  };
}
