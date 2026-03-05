import type { VersionConfig } from '@releasekit/config';
import type { ReleaseType } from 'semver';

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
  name?: string;
  strictReachable?: boolean;
}

export interface Config extends VersionConfigBase {
  tagTemplate: string;
  packageSpecificTags?: boolean;
  preset: string;
  sync: boolean;
  packages: string[];
  mainPackage?: string;
  updateInternalDependencies: 'major' | 'minor' | 'patch' | 'no-internal-update';
  skip?: string[];
  commitMessage?: string;
  versionStrategy?: 'branchPattern' | 'commitMessage';
  branchPatterns?: BranchPattern[];
  defaultReleaseType?: ReleaseType;
  skipHooks?: boolean;
  dryRun?: boolean;
  latestTag?: string;
  isPrerelease?: boolean;
  mismatchStrategy?: 'error' | 'warn' | 'ignore' | 'prefer-package' | 'prefer-git';
  strictReachable?: boolean;
  cargo?: {
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
}

export interface GitProcess {
  files: string[];
  nextTag: string;
  commitMessage: string;
  skipHooks?: boolean;
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
      updateInternalDependencies: 'minor',
      versionPrefix: '',
    };
  }

  return {
    tagTemplate: config.tagTemplate ?? 'v{version}',
    packageSpecificTags: config.packageSpecificTags,
    preset: config.preset ?? 'conventional',
    sync: config.sync ?? true,
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
    skipHooks: config.skipHooks,
    mismatchStrategy: config.mismatchStrategy,
    versionPrefix: config.versionPrefix ?? '',
    prereleaseIdentifier: config.prereleaseIdentifier,
    baseBranch: config.baseBranch,
    cargo: config.cargo,
  };
}
