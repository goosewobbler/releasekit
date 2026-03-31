import type { PublishConfig as BasePublishConfig } from '@releasekit/config';
import type { VersionOutput } from '@releasekit/core';
import type { PackageManager } from './utils/package-manager.js';

export interface NpmConfig {
  enabled: boolean;
  auth: 'auto' | 'oidc' | 'token';
  provenance: boolean;
  access: 'public' | 'restricted';
  registry: string;
  copyFiles: string[];
  tag: string;
}

export interface CargoConfig {
  enabled: boolean;
  noVerify: boolean;
  publishOrder: string[];
  clean: boolean;
}

export interface GitConfig {
  push: boolean;
  pushMethod: 'auto' | 'ssh' | 'https';
  remote: string;
  branch: string | undefined;
  httpsTokenEnv?: string;
  skipHooks?: boolean;
}

export interface GitHubReleaseConfig {
  enabled: boolean;
  draft: boolean;
  perPackage: boolean;
  prerelease: 'auto' | boolean;
  /** 'auto' | 'releaseNotes' | 'changelog' | 'generated' | 'none' */
  body: 'auto' | 'releaseNotes' | 'changelog' | 'generated' | 'none';
  /** Template for the release title when a package name is resolved. Variables: ${packageName}, ${version}. */
  titleTemplate: string;
}

export interface VerifyRegistryConfig {
  enabled: boolean;
  maxAttempts: number;
  initialDelay: number;
  backoffMultiplier: number;
}

export interface VerifyConfig {
  npm: VerifyRegistryConfig;
  cargo: VerifyRegistryConfig;
}

export interface PublishConfig {
  npm: NpmConfig;
  cargo: CargoConfig;
  git: GitConfig;
  githubRelease: GitHubReleaseConfig;
  verify: VerifyConfig;
}

export interface PublishCliOptions {
  input?: string;
  config?: string;
  registry: 'npm' | 'cargo' | 'all';
  npmAuth: 'auto' | 'oidc' | 'token';
  dryRun: boolean;
  skipGit: boolean;
  skipGitCommit?: boolean;
  skipPublish: boolean;
  skipGithubRelease: boolean;
  skipVerification: boolean;
  json: boolean;
  verbose: boolean;
  /** Per-package release notes keyed by package name, from the notes pipeline. */
  releaseNotes?: Record<string, string>;
  /** Additional files to stage in the git commit (e.g., changelog files from the notes step). */
  additionalFiles?: string[];
}

export interface PublishResult {
  packageName: string;
  version: string;
  registry: 'npm' | 'cargo';
  success: boolean;
  skipped: boolean;
  reason?: string;
  alreadyPublished?: boolean;
}

export interface VerificationResult {
  packageName: string;
  version: string;
  registry: 'npm' | 'cargo';
  verified: boolean;
  attempts: number;
}

export interface GitHubReleaseResult {
  tag: string;
  url?: string;
  draft: boolean;
  prerelease: boolean;
  success: boolean;
  reason?: string;
}

export interface GitResult {
  committed: boolean;
  tags: string[];
  pushed: boolean;
}

export interface PublishOutput {
  dryRun: boolean;
  git: GitResult;
  npm: PublishResult[];
  cargo: PublishResult[];
  verification: VerificationResult[];
  githubReleases: GitHubReleaseResult[];
  publishSucceeded: boolean;
}

export interface PipelineContext {
  input: VersionOutput;
  config: PublishConfig;
  cliOptions: PublishCliOptions;
  packageManager: PackageManager;
  output: PublishOutput;
  cwd: string;
  /** Per-package release notes keyed by package name, passed from the notes pipeline. */
  releaseNotes?: Record<string, string>;
  /** Additional files to stage in the git commit (e.g., changelog files from the notes step). */
  additionalFiles?: string[];
}

export function getDefaultConfig(): PublishConfig {
  return {
    npm: {
      enabled: true,
      auth: 'auto',
      provenance: true,
      access: 'public',
      registry: 'https://registry.npmjs.org',
      copyFiles: ['LICENSE'],
      tag: 'latest',
    },
    cargo: {
      enabled: false,
      noVerify: false,
      publishOrder: [],
      clean: false,
    },
    git: {
      push: true,
      pushMethod: 'auto',
      remote: 'origin',
      branch: undefined,
      httpsTokenEnv: undefined,
      skipHooks: false,
    },
    githubRelease: {
      enabled: true,
      draft: true,
      perPackage: true,
      prerelease: 'auto',
      body: 'auto',
      titleTemplate: '${packageName}: ${version}',
    },
    verify: {
      npm: {
        enabled: true,
        maxAttempts: 5,
        initialDelay: 15000,
        backoffMultiplier: 2,
      },
      cargo: {
        enabled: true,
        maxAttempts: 10,
        initialDelay: 30000,
        backoffMultiplier: 2,
      },
    },
  };
}

export function toPublishConfig(config: BasePublishConfig | undefined): PublishConfig {
  const defaults = getDefaultConfig();

  if (!config) return defaults;

  return {
    npm: {
      enabled: config.npm?.enabled ?? defaults.npm.enabled,
      auth: config.npm?.auth ?? defaults.npm.auth,
      provenance: config.npm?.provenance ?? defaults.npm.provenance,
      access: config.npm?.access ?? defaults.npm.access,
      registry: config.npm?.registry ?? defaults.npm.registry,
      copyFiles: config.npm?.copyFiles ?? defaults.npm.copyFiles,
      tag: config.npm?.tag ?? defaults.npm.tag,
    },
    cargo: {
      enabled: config.cargo?.enabled ?? defaults.cargo.enabled,
      noVerify: config.cargo?.noVerify ?? defaults.cargo.noVerify,
      publishOrder: config.cargo?.publishOrder ?? defaults.cargo.publishOrder,
      clean: config.cargo?.clean ?? defaults.cargo.clean,
    },
    git: config.git
      ? {
          push: config.git.push ?? defaults.git.push,
          pushMethod: config.git.pushMethod ?? defaults.git.pushMethod,
          remote: config.git.remote ?? defaults.git.remote,
          branch: config.git.branch ?? defaults.git.branch,
          httpsTokenEnv: config.git.httpsTokenEnv ?? defaults.git.httpsTokenEnv,
          skipHooks: config.git.skipHooks ?? defaults.git.skipHooks,
        }
      : defaults.git,
    githubRelease: {
      enabled: config.githubRelease?.enabled ?? defaults.githubRelease.enabled,
      draft: config.githubRelease?.draft ?? defaults.githubRelease.draft,
      perPackage: config.githubRelease?.perPackage ?? defaults.githubRelease.perPackage,
      prerelease: config.githubRelease?.prerelease ?? defaults.githubRelease.prerelease,
      body: config.githubRelease?.body ?? defaults.githubRelease.body,
      titleTemplate: config.githubRelease?.titleTemplate ?? defaults.githubRelease.titleTemplate,
    },
    verify: {
      npm: {
        enabled: config.verify?.npm?.enabled ?? defaults.verify.npm.enabled,
        maxAttempts: config.verify?.npm?.maxAttempts ?? defaults.verify.npm.maxAttempts,
        initialDelay: config.verify?.npm?.initialDelay ?? defaults.verify.npm.initialDelay,
        backoffMultiplier: config.verify?.npm?.backoffMultiplier ?? defaults.verify.npm.backoffMultiplier,
      },
      cargo: {
        enabled: config.verify?.cargo?.enabled ?? defaults.verify.cargo.enabled,
        maxAttempts: config.verify?.cargo?.maxAttempts ?? defaults.verify.cargo.maxAttempts,
        initialDelay: config.verify?.cargo?.initialDelay ?? defaults.verify.cargo.initialDelay,
        backoffMultiplier: config.verify?.cargo?.backoffMultiplier ?? defaults.verify.cargo.backoffMultiplier,
      },
    },
  };
}
