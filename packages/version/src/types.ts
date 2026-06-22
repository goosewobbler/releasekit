import type { GitConfig, VersionConfig, VersionGroup } from '@releasekit/config';
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
  branchPattern?: string[];
  baseBranch?: string;
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
  mainPackage?: string;
  updateInternalDependencies: 'major' | 'minor' | 'patch' | 'no-internal-update';
  skip?: string[];
  commitMessage?: string;
  versionStrategy?: 'branchPattern' | 'commitMessage';
  branchPatterns?: BranchPattern[];
  defaultReleaseType?: ReleaseType;
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
  mismatchStrategy?: 'error' | 'warn' | 'ignore' | 'prefer-package' | 'prefer-git';
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

export interface BranchPattern {
  pattern: string;
  releaseType: ReleaseType;
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

export function toVersionConfig(config: VersionConfig | undefined, gitConfig?: GitConfig): Config {
  if (!config) {
    return {
      tagTemplate: 'v{version}',
      packageSpecificTags: false,
      preset: 'conventional',
      sync: true,
      packages: [],
      updateInternalDependencies: 'minor',
      versionPrefix: '',
      baseBranch: gitConfig?.branch,
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
    mainPackage: config.mainPackage,
    updateInternalDependencies: config.updateInternalDependencies ?? 'minor',
    skip: config.skip,
    commitMessage: config.commitMessage,
    versionStrategy: config.versionStrategy,
    branchPatterns: config.branchPatterns?.map((bp: { pattern: string; releaseType: string }) => ({
      pattern: bp.pattern,
      releaseType: bp.releaseType as ReleaseType,
    })),
    defaultReleaseType: config.defaultReleaseType as ReleaseType | undefined,
    mismatchStrategy: config.mismatchStrategy,
    zeroMajor: config.zeroMajor,
    versionPrefix: config.versionPrefix ?? '',
    prereleaseIdentifier: config.prereleaseIdentifier,
    baseBranch: gitConfig?.branch,
    cargo: config.cargo,
    pub: config.pub,
  };
}
