import { type PublishConfig as BasePublishConfig, PublishConfigSchema } from '@releasekit/config';
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
  publishOrder: string[];
}

export interface CargoConfig {
  enabled: boolean;
  noVerify: boolean;
  publishOrder: string[];
  clean: boolean;
}

export interface PubConfig {
  enabled: boolean;
  publishOrder: string[];
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
  /** Package names to exclude from GitHub release creation. Tags and npm publish are unaffected. */
  skipPackages: string[];
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
  pub: VerifyRegistryConfig;
}

export interface PublishConfig {
  npm: NpmConfig;
  cargo: CargoConfig;
  pub: PubConfig;
  git: GitConfig;
  githubRelease: GitHubReleaseConfig;
  verify: VerifyConfig;
}

export interface PublishCliOptions {
  input?: string;
  config?: string;
  registry: 'npm' | 'cargo' | 'pub' | 'all';
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
  /** The name in `VersionOutput`. `packageName` is the registry's name, which differs for some crates and Dart packages. */
  updatePackageName: string;
  version: string;
  registry: 'npm' | 'cargo' | 'pub';
  success: boolean;
  skipped: boolean;
  reason?: string;
  alreadyPublished?: boolean;
  /**
   * Number of publish attempts made for this package (1 = succeeded first try,
   * >1 = transient errors were retried). Recorded so the failure report can
   * surface retry activity. Absent for packages that were never attempted
   * (e.g. private/already-published skips).
   */
  attempts?: number;
}

export interface VerificationResult {
  packageName: string;
  version: string;
  registry: 'npm' | 'cargo' | 'pub';
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
  pub: PublishResult[];
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
  /** HEAD was already the release commit: nothing was committed this run, but the branch still needs pushing. */
  releaseCommitReused?: boolean;
}

export function getDefaultConfig(): PublishConfig {
  return toPublishConfig(PublishConfigSchema.parse({}));
}

export function toPublishConfig(config: BasePublishConfig): PublishConfig {
  // Zod shallow-clones defaults, so nested default objects would otherwise be shared between configs.
  const { npm, cargo, pub, git, githubRelease, verify } = structuredClone(config);
  return {
    npm,
    cargo,
    pub,
    // publish.git has no schema defaults (it inherits the top-level git at load), so its fallbacks live here.
    git: {
      push: git?.push ?? true,
      pushMethod: git?.pushMethod ?? 'auto',
      remote: git?.remote ?? 'origin',
      branch: git?.branch,
      httpsTokenEnv: git?.httpsTokenEnv,
      skipHooks: git?.skipHooks ?? false,
    },
    githubRelease,
    verify,
  };
}
