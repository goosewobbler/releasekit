import { DEFAULT_PRESET, type Preset, type VersionConfig, type VersionGroup } from '@releasekit/config';
import type { ReleaseType } from 'semver';

/** `name` is the group's config key. */
export interface VersionGroupConfig extends VersionGroup {
  name: string;
}

/** Runtime overrides from an orchestrator (e.g. @releasekit/release), kept apart from file-loaded Config. */
export interface VersionRunOptions {
  /** Equivalent to --bump. */
  bump?: ReleaseType;
  /** A string overrides the identifier (e.g. 'beta'); true uses the configured one, falling back to 'next'. */
  prerelease?: string | boolean;
  /** Graduate prerelease packages to stable; skip already-stable packages
   *  unless bump is also set, in which case bump applies to stable packages. */
  stable?: boolean;
  /**
   * Package name patterns to graduate to stable, leaving other prereleases on their line. `stable`
   * wins when both are set.
   */
  graduate?: string[];
  /**
   * Twin of {@link graduate}: package name patterns to shift onto a prerelease line WITHOUT narrowing
   * the release. `prerelease` wins when both are set.
   */
  prereleaseScope?: string[];
  /** Acknowledge a first-release bump on a stable manifest, silencing the overshoot guard. */
  allowFirstBump?: boolean;
  dryRun?: boolean;
  sync?: boolean;
  /** Limit release to these package name patterns. */
  targets?: string[];
  /**
   * Commit SHA to start the revision range from instead of the last release tag, for both the bump and
   * the changelog - e.g. to analyse only a PR's own commits.
   */
  baseRef?: string;
  /**
   * Package name patterns the `bump` / `prerelease` / `stable` override applies to; the rest fall
   * through to commit-driven calculation.
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
   * Package names dropped from the release set as the final discovery filter, after `targets`,
   * `packages` and prerequisite expansion. Used by standing-PR ad-hoc selection, so an unchecked
   * package leaves no orphan bump. Exact names, not patterns.
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
  /** Directory for commit-count checks, overriding `path`. */
  commitCheckPath?: string;
  name?: string;
  strictReachable?: boolean;
}

export interface Config extends VersionConfigBase {
  tagTemplate: string;
  /** Secondary tag for an internal "baseline" marker on the release commit that stays on the source
   *  branch when a downstream step (e.g. an action-dist build) force-moves the `tagTemplate` tag off
   *  it; version-bump and changelog logic read it instead. Same substitutions as `tagTemplate`. */
  baselineTagTemplate?: string;
  packageSpecificTags?: boolean;
  preset: Preset;
  sync: boolean;
  groups?: Record<string, VersionGroup>;
  packages: string[];
  /** Foundational packages whose changes route to repo-level ("Project-wide changes") in every
   *  package's changelog (exact name or glob). */
  sharedPackages?: string[];
  /** See VersionConfig.sharedChangelogFloor. */
  sharedChangelogFloor?: 'union' | 'sinceLastRelease';
  mainPackage?: string;
  skip?: string[];
  /** Include npm packages marked `"private": true` in the release flow. */
  includePrivate?: boolean;
  commitMessage?: string;
  dryRun?: boolean;
  latestTag?: string;
  isPrerelease?: boolean;
  stableOnly?: boolean;
  /** Runtime override - see VersionRunOptions.baseRef. */
  baseRef?: string;
  /** Runtime override - see VersionRunOptions.overrideScope. */
  overrideScope?: string[];
  /** Runtime override (see VersionRunOptions.graduate), always set together with `stableOnly`. Empty
   *  with `stableOnly` set graduates every prerelease. */
  graduateScope?: string[];
  /** Runtime override (see VersionRunOptions.prereleaseScope), always set together with `isPrerelease`.
   *  Empty with `isPrerelease` set shifts every package. */
  prereleaseScope?: string[];
  /** Engine-populated: every discovered package, before release-set filtering. Not user config. */
  allWorkspacePackages?: Array<{ name: string; dir: string }>;
  mismatchStrategy?: 'error' | 'warn' | 'ignore' | 'prefer-package' | 'prefer-git';
  allowFirstBump?: boolean;
  strictReachable?: boolean;
  /** Pre-1.0 inferred-breaking bump policy. See docs/configuration.md#versionzeromajor. */
  zeroMajor?: 'spec' | 'strict';
  npm?: {
    enabled?: boolean;
  };
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
      preset: DEFAULT_PRESET,
      sync: true,
      packages: [],
      versionPrefix: '',
    };
  }

  return {
    tagTemplate: config.tagTemplate ?? 'v{version}',
    baselineTagTemplate: config.baselineTagTemplate,
    packageSpecificTags: config.packageSpecificTags,
    preset: config.preset ?? DEFAULT_PRESET,
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
    npm: config.npm,
    cargo: config.cargo,
    pub: config.pub,
  };
}
