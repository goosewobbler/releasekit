import type { VersionOutput } from '@releasekit/core';
import type { PackageManager } from './utils/package-manager.js';

// ---- Config types ----

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
  branch: string;
}

export interface GitHubReleaseConfig {
  enabled: boolean;
  draft: boolean;
  generateNotes: boolean;
  perPackage: boolean;
  prerelease: 'auto' | boolean;
  notesFile?: string;
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

// ---- CLI options ----

export interface PublishCliOptions {
  input?: string;
  config?: string;
  registry: 'npm' | 'cargo' | 'all';
  npmAuth: 'auto' | 'oidc' | 'token';
  dryRun: boolean;
  skipGit: boolean;
  skipPublish: boolean;
  skipGithubRelease: boolean;
  skipVerification: boolean;
  json: boolean;
  verbose: boolean;
}

// ---- Output types ----

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
}

// ---- Pipeline context (internal, passed between stages) ----

export interface PipelineContext {
  input: VersionOutput;
  config: PublishConfig;
  cliOptions: PublishCliOptions;
  packageManager: PackageManager;
  output: PublishOutput;
  cwd: string;
}
