import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';
import { ConfigError } from './errors.js';
import { mergeGitConfig } from './merge.js';
import { parseJsonc } from './parse.js';
import {
  type CIConfig,
  type GitConfig,
  type NotesConfig,
  type PublishConfig,
  type ReleaseConfig,
  type ReleaseKitConfig,
  ReleaseKitConfigSchema,
  type VersionConfig,
} from './schema.js';
import { substituteInObject } from './substitute.js';

export interface LoadOptions {
  cwd?: string;
  configPath?: string;
}

// Default config filenames, in lookup order. `.jsonc` is tried after `.json`.
const CONFIG_FILES = ['releasekit.config.json', 'releasekit.config.jsonc'] as const;

function resolveConfigPath(cwd: string): string {
  for (const file of CONFIG_FILES) {
    const candidate = path.join(cwd, file);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  // None found — return the primary path so the not-found path is exercised.
  return path.join(cwd, CONFIG_FILES[0]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * `notes.releaseNotes` no longer mirrors the changelog's location modes (release notes are not a
 * changelog). Fail loudly with migration guidance instead of letting Zod silently strip the removed
 * keys — which would otherwise turn off a user's file output without a word.
 */
function assertNoRemovedReleaseNotesFields(config: unknown): void {
  if (!isRecord(config) || !isRecord(config.notes) || !isRecord(config.notes.releaseNotes)) return;
  const rn = config.notes.releaseNotes;
  const removed: string[] = [];
  if ('mode' in rn) removed.push('mode');
  if ('directory' in rn) removed.push('directory');
  if (typeof rn.file === 'string') removed.push('file (string)');
  if (removed.length === 0) return;
  throw new ConfigError(
    `notes.releaseNotes no longer supports ${removed.join(', ')}. Release notes go to the GitHub ` +
      'release body by default; for in-repo per-version files set notes.releaseNotes.file to ' +
      '{ "dir": "release-notes" }. For a cumulative changelog file, use changelog.mode.',
  );
}

/**
 * Branch-pattern versioning (`versionStrategy` / `branchPatterns` / `defaultReleaseType`) and
 * `updateInternalDependencies` were removed — they were unwired and did nothing. Fail loudly with
 * migration guidance instead of letting Zod silently strip them (which would also diverge from the
 * generated JSON schema, where editors/CI reject the same unknown keys).
 */
function assertNoRemovedVersionFields(config: unknown): void {
  if (!isRecord(config) || !isRecord(config.version)) return;
  const v = config.version;
  const removed = ['versionStrategy', 'branchPatterns', 'defaultReleaseType', 'updateInternalDependencies'].filter(
    (k) => k in v,
  );
  if (removed.length === 0) return;
  throw new ConfigError(
    `version no longer supports ${removed.join(', ')}. Branch-pattern versioning was never functional — ` +
      'use Conventional Commits or --bump for version bumps. For coupled packages use version.groups; to ' +
      "release a package's changed dependencies use release:with-prerequisites / --include-prerequisites.",
  );
}

/**
 * `ci.autoRelease` was removed (it had no effect), and the top-level `ci.skipPatterns` / `ci.minChanges`
 * were shadowed dead duplicates — the live settings are `release.ci.skipPatterns` / `release.ci.minChanges`.
 * `monorepo.mainPackage` duplicated `version.mainPackage`. Fail loudly with migration guidance rather than
 * silently stripping these (which also diverges from the JSON schema's unknown-key rejection).
 */
function assertNoRemovedTopLevelFields(config: unknown): void {
  if (!isRecord(config)) return;
  if (isRecord(config.ci)) {
    const removed = ['autoRelease', 'skipPatterns', 'minChanges'].filter((k) => k in (config.ci as object));
    if (removed.length > 0) {
      throw new ConfigError(
        `ci no longer supports ${removed.join(', ')}. autoRelease was removed (it had no effect); ` +
          'skipPatterns and minChanges live under release.ci (release.ci.skipPatterns / release.ci.minChanges).',
      );
    }
  }
  if (isRecord(config.monorepo) && 'mainPackage' in config.monorepo) {
    throw new ConfigError('monorepo.mainPackage was removed — use version.mainPackage instead.');
  }
}

/**
 * `monorepo.mode` was removed — it never drove behaviour (changelog aggregation is controlled by
 * notes.changelog.mode). Fail loudly with migration guidance rather than silently stripping it.
 */
function assertNoRemovedMonorepoMode(config: unknown): void {
  if (isRecord(config) && isRecord(config.monorepo) && 'mode' in config.monorepo) {
    throw new ConfigError('monorepo.mode was removed — changelog aggregation is controlled by notes.changelog.mode.');
  }
}

function loadConfigFile(configPath: string): ReleaseKitConfig {
  if (!fs.existsSync(configPath)) {
    return {};
  }

  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    const parsed = parseJsonc(content);
    const substituted = substituteInObject(parsed);
    assertNoRemovedReleaseNotesFields(substituted);
    assertNoRemovedVersionFields(substituted);
    assertNoRemovedTopLevelFields(substituted);
    assertNoRemovedMonorepoMode(substituted);
    return ReleaseKitConfigSchema.parse(substituted);
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      const issues = error.issues.map((i: z.ZodIssue) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
      throw new ConfigError(`Config validation errors:\n${issues}`);
    }
    if (error instanceof SyntaxError) {
      throw new ConfigError(`Invalid JSON in config file: ${error.message}`);
    }
    throw error;
  }
}

export function loadConfig(options?: LoadOptions): ReleaseKitConfig {
  const cwd = options?.cwd ?? process.cwd();
  const configPath = options?.configPath ?? resolveConfigPath(cwd);

  return loadConfigFile(configPath);
}

export function loadVersionConfig(options?: LoadOptions): VersionConfig | undefined {
  const config = loadConfig(options);
  return config.version;
}

export function loadPublishConfig(options?: LoadOptions): PublishConfig | undefined {
  const config = loadConfig(options);

  if (!config.publish) return undefined;

  const mergedGit = mergeGitConfig(config.git, config.publish.git);

  return {
    ...config.publish,
    git: mergedGit
      ? {
          push: mergedGit.push ?? true,
          pushMethod: mergedGit.pushMethod,
          remote: mergedGit.remote,
          branch: mergedGit.branch,
          httpsTokenEnv: mergedGit.httpsTokenEnv,
          skipHooks: mergedGit.skipHooks,
        }
      : undefined,
  };
}

export function loadNotesConfig(options?: LoadOptions): NotesConfig | undefined {
  const config = loadConfig(options);
  return config.notes;
}

export function loadGitConfig(options?: LoadOptions): GitConfig | undefined {
  const config = loadConfig(options);
  return config.git;
}

export function loadMonorepoConfig(options?: LoadOptions) {
  const config = loadConfig(options);
  return config.monorepo;
}

export function loadCIConfig(options?: LoadOptions): CIConfig | undefined {
  const config = loadConfig(options);
  return config.ci;
}

export function loadReleaseConfig(options?: LoadOptions): ReleaseConfig | undefined {
  const config = loadConfig(options);
  return config.release;
}
