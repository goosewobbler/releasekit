import { execSync } from 'node:child_process';
import type { CIConfig, ReleaseConfig } from '@releasekit/config';
import { loadConfig as loadReleaseKitConfig } from '@releasekit/config';
import type { VersionOutput } from '@releasekit/core';
import { error, info, setJsonMode, setLogLevel, setQuietMode, success, warn } from '@releasekit/core';
import type { ReleaseType } from 'semver';
import { DEFAULT_LABELS, detectLabelConflicts } from './label-utils.js';
import { createOctokit, fetchPRLabels, findMergedPRsForCommit } from './preview-github.js';
import type { ReleaseOptions, ReleaseOutput } from './types.js';

export function resolveScopeToTarget(scopeName: string, scopeLabels: Record<string, string>): string {
  const prefixed = `scope:${scopeName}`;
  if (scopeLabels[prefixed]) return scopeLabels[prefixed];
  if (scopeLabels[scopeName]) return scopeLabels[scopeName];
  const available = Object.keys(scopeLabels).join(', ');
  throw new Error(`Scope "${scopeName}" not found in ci.scopeLabels. Available: ${available}`);
}

export function getHeadCommitMessage(cwd?: string): string | null {
  try {
    return execSync('git log -1 --pretty=%s', { encoding: 'utf-8', cwd }).trim();
  } catch {
    return null;
  }
}

export function getGitHubContext(): { owner: string; repo: string; sha: string } | null {
  const repo = process.env.GITHUB_REPOSITORY;
  const sha = process.env.GITHUB_SHA;

  if (!repo || !sha) {
    return null;
  }

  const [owner, repoName] = repo.split('/');
  if (!owner || !repoName) {
    return null;
  }

  return { owner, repo: repoName, sha };
}

interface PRLabelsResult {
  target: string | undefined;
  scopeLabels: string[];
  labels: string[];
  blocked?: boolean;
  skipped?: boolean;
}

async function applyScopeLabelsFromPR(
  ciConfig: CIConfig | undefined,
  options: ReleaseOptions,
): Promise<PRLabelsResult> {
  const scopeLabels = ciConfig?.scopeLabels ?? {};
  const defaultScope = ciConfig?.defaultScope;

  const githubContext = getGitHubContext();
  if (!githubContext) {
    return { target: options.target, scopeLabels: [], labels: [] };
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    warn('No GITHUB_TOKEN available — skipping scope label detection');
    return { target: options.target, scopeLabels: [], labels: [] };
  }

  const octokit = createOctokit(token);

  const prNumbers = await findMergedPRsForCommit(octokit, githubContext.owner, githubContext.repo, githubContext.sha);
  const allLabels: string[] = [];
  const perPRLabels: Map<number, string[]> = new Map();

  for (const prNumber of prNumbers) {
    const labels = await fetchPRLabels(octokit, githubContext.owner, githubContext.repo, prNumber);
    allLabels.push(...labels);
    perPRLabels.set(prNumber, labels);
  }

  // Check for label conflicts per-PR (not aggregated across PRs)
  // Labels from different PRs don't conflict with each other
  const labels = ciConfig?.labels ?? DEFAULT_LABELS;
  for (const [prNumber, prLabels] of perPRLabels) {
    const conflict = detectLabelConflicts(prLabels, labels);

    // Check for release:skip label (only in commit trigger mode)
    if ((ciConfig?.releaseTrigger ?? 'label') === 'commit' && prLabels.includes(labels.skip)) {
      info(`PR #${prNumber} has "${labels.skip}" label — skipping release`);
      return { target: options.target, scopeLabels: [], labels: [], skipped: true };
    }

    // Warn if skip label is used in label mode (not effective)
    if (prLabels.includes(labels.skip)) {
      warn(`PR #${prNumber} has "${labels.skip}" label — this has no effect in label trigger mode`);
    }

    if (conflict.prereleaseConflict) {
      warn(`PR #${prNumber} has conflicting labels "${labels.stable}" and "${labels.prerelease}" — release blocked`);
      return { target: options.target, scopeLabels: [], labels: [], blocked: true };
    }
    if (conflict.bumpConflict && (ciConfig?.releaseTrigger ?? 'label') === 'label') {
      warn(`PR #${prNumber} has conflicting bump labels (${conflict.bumpLabelsPresent.join(', ')}) — release blocked`);
      return { target: options.target, scopeLabels: [], labels: [], blocked: true };
    }
  }

  if (prNumbers.length === 0) {
    if (defaultScope && Object.keys(scopeLabels).length > 0) {
      const defaultPattern = scopeLabels[defaultScope];
      if (defaultPattern) {
        info(`No merged PRs found — using default scope "${defaultScope}" (${defaultPattern})`);
        return { target: defaultPattern, scopeLabels: [], labels: allLabels };
      }
    }
    info('No merged PRs found for HEAD commit — releasing all packages');
    return { target: options.target, scopeLabels: [], labels: allLabels };
  }

  const matchedScopePatterns: string[] = [];
  for (const [labelName, packagePattern] of Object.entries(scopeLabels)) {
    if (allLabels.includes(labelName)) {
      info(`Scope label "${labelName}" detected — limiting release to packages matching "${packagePattern}"`);
      matchedScopePatterns.push(packagePattern);
    }
  }

  let finalTarget = options.target;
  if (matchedScopePatterns.length > 0) {
    finalTarget = matchedScopePatterns.join(', ');
  } else if (defaultScope && Object.keys(scopeLabels).length > 0) {
    const defaultPattern = scopeLabels[defaultScope];
    if (defaultPattern) {
      info(`No scope label found — using default scope "${defaultScope}" (${defaultPattern})`);
      finalTarget = defaultPattern;
    }
  }

  return { target: finalTarget, scopeLabels: matchedScopePatterns, labels: allLabels };
}

/**
 * Apply config-driven step overrides to the options object.
 * Priority order: CLI flags (already set on options) > release.ci overrides > release.steps.
 * The CLI always wins because both checks guard with !options.skipX before setting.
 */
function applyStepOverrides(options: ReleaseOptions, releaseConfig: ReleaseConfig | undefined): void {
  // Steps array: a step absent from the list is skipped unless CLI already set the flag.
  if (releaseConfig?.steps) {
    if (!releaseConfig.steps.includes('notes') && !options.skipNotes) options.skipNotes = true;
    if (!releaseConfig.steps.includes('publish') && !options.skipPublish) options.skipPublish = true;
  }

  // ci overrides: can suppress a step even when it appears in 'steps'.
  if (releaseConfig?.ci?.notes === false && !options.skipNotes) options.skipNotes = true;
  if (releaseConfig?.ci?.githubRelease === false && !options.skipGithubRelease) options.skipGithubRelease = true;
}

export async function runRelease(inputOptions: ReleaseOptions): Promise<ReleaseOutput | null> {
  // Work on a copy so config-driven overrides never mutate the caller's object
  const options = { ...inputOptions };

  if (options.verbose) setLogLevel('debug');
  if (options.quiet) setQuietMode(true);
  if (options.json) setJsonMode(true);

  // Load release config for automation behavior
  let releaseKitConfig: ReturnType<typeof loadReleaseKitConfig>;
  try {
    releaseKitConfig = loadReleaseKitConfig({ cwd: options.projectDir, configPath: options.config });
  } catch (err) {
    error(`Failed to load release config: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  }
  const releaseConfig = releaseKitConfig.release;
  const ciConfig = releaseKitConfig.ci;

  // Resolve --scope flag to target packages if provided
  if (options.scope) {
    if (!ciConfig?.scopeLabels || Object.keys(ciConfig.scopeLabels).length === 0) {
      throw new Error(`--scope "${options.scope}" provided but ci.scopeLabels is not configured`);
    }
    const resolvedTarget = resolveScopeToTarget(options.scope, ciConfig.scopeLabels);
    info(`Scope "${options.scope}" resolved to target: ${resolvedTarget}`);
    options.target = resolvedTarget;
  }

  // Apply scope labels from PR labels (if GitHub context available)
  // Skip in dry-run mode since preview.ts already handles scope labels

  // Determine effective target: CLI target can be overridden by scope labels
  let effectiveTarget = options.target;

  // Only apply scope labels in non-dry-run (release) mode
  // In dry-run/preview mode, preview.ts already handles scope labels via applyLabelOverrides
  // However, we still call applyScopeLabelsFromPR to detect label conflicts (e.g., release:stable + release:prerelease)
  const scopeResult = await applyScopeLabelsFromPR(ciConfig, options);
  if (scopeResult.blocked) {
    info('Release blocked due to conflicting PR labels');
    return null;
  }
  if (scopeResult.skipped) {
    info('Release skipped due to release:skip label');
    return null;
  }
  // Only update effectiveTarget in real (non-dry-run) mode;
  // preview.ts already handles scope label targeting in dry-run mode.
  if (!options.dryRun && scopeResult.target !== options.target) {
    info(`Scope labels override target: ${options.target} → ${scopeResult.target}`);
    effectiveTarget = scopeResult.target;
  }

  // Apply skipPatterns: exit early if HEAD commit matches a skip pattern
  if (releaseConfig?.ci?.skipPatterns?.length) {
    const headCommit = getHeadCommitMessage(options.projectDir);
    if (headCommit) {
      const matchedPattern = releaseConfig.ci.skipPatterns.find(
        (p) => headCommit.startsWith(p) || headCommit.includes(p),
      );
      if (matchedPattern) {
        info(`Skipping release: commit message matches skip pattern "${matchedPattern}"`);
        return null;
      }
    }
  }

  applyStepOverrides(options, releaseConfig);

  // --- Step 1: Version ---
  // Always run the version engine with dryRun:true so no files are written yet.
  // File writes are captured as pending writes instead of going to disk, allowing
  // all early-exit guards to be evaluated before the repository is modified.
  info('Running version analysis...');
  const versionOutput = await runVersionStep({ ...options, target: effectiveTarget, dryRun: true });
  // The preflight always runs with dryRun:true, so _jsonData.dryRun is always
  // true in the snapshot. Restore the caller's actual intent before forwarding
  // to downstream steps (notes, publish) that inspect this flag.
  versionOutput.dryRun = options.dryRun ?? false;

  if (versionOutput.updates.length === 0) {
    info('No releasable changes found');
    return null;
  }

  // Apply minChanges threshold before modifying any files
  if (releaseConfig?.ci?.minChanges !== undefined && versionOutput.updates.length < releaseConfig.ci.minChanges) {
    info(
      `Skipping release: ${versionOutput.updates.length} package(s) to update, minimum is ${releaseConfig.ci.minChanges}`,
    );
    return null;
  }

  // All guards passed. For a real (non-dry) run, flush the pending writes captured
  // during the dryRun pass above so version bumps land on disk exactly once.
  if (!options.dryRun) {
    const { flushPendingWrites } = await import('@releasekit/version');
    flushPendingWrites();
  }

  info(`Found ${versionOutput.updates.length} package update(s)`);
  for (const update of versionOutput.updates) {
    info(`  ${update.packageName} → ${update.newVersion}`);
  }

  // --- Step 2: Notes ---
  let notesGenerated = false;
  let packageNotes: Record<string, string> | undefined;
  let releaseNotes: Record<string, string> | undefined;
  let notesFiles: string[] = [];
  if (!options.skipNotes) {
    info('Generating release notes...');
    const notesResult = await runNotesStep(versionOutput, options);
    packageNotes = notesResult.packageNotes;
    releaseNotes = notesResult.releaseNotes;
    notesFiles = notesResult.files;
    notesGenerated = true;
    success('Release notes generated');
  }

  // --- Step 3: Publish ---
  // The publish step's git-commit stage commits version bumps + changelogs + tags.
  let publishOutput: ReleaseOutput['publishOutput'];
  if (!options.skipPublish) {
    info('Publishing...');
    publishOutput = await runPublishStep(versionOutput, options, releaseNotes, notesFiles);
    success('Publish complete');
  }

  return { versionOutput, notesGenerated, packageNotes, releaseNotes, publishOutput };
}

async function runVersionStep(options: ReleaseOptions): Promise<VersionOutput> {
  const { loadConfig, VersionEngine, enableJsonOutput, getJsonData } = await import('@releasekit/version');

  enableJsonOutput(options.dryRun);

  const config = loadConfig({ cwd: options.projectDir, configPath: options.config });

  const targets: string[] = options.target ? options.target.split(',').map((t) => t.trim()) : [];

  const runOptions = {
    bump: options.bump as ReleaseType | undefined,
    prerelease: options.prerelease,
    stable: options.stable,
    dryRun: options.dryRun,
    sync: options.sync,
    targets,
  };

  const engine = new VersionEngine(config, runOptions);
  const pkgsResult = await engine.getWorkspacePackages();
  const resolvedCount = pkgsResult.packages.length;

  if (resolvedCount === 0) {
    throw new Error('No packages found in workspace');
  }

  const effectiveSync = options.sync || config.sync;
  if (effectiveSync) {
    engine.setStrategy('sync');
    await engine.run(pkgsResult);
  } else if (resolvedCount === 1) {
    engine.setStrategy('single');
    await engine.run(pkgsResult);
  } else {
    engine.setStrategy('async');
    await engine.run(pkgsResult, targets);
  }

  return getJsonData() as VersionOutput;
}

interface NotesStepResult {
  packageNotes: Record<string, string>;
  releaseNotes?: Record<string, string>;
  files: string[];
}

async function runNotesStep(versionOutput: VersionOutput, options: ReleaseOptions): Promise<NotesStepResult> {
  const { versionOutputToChangelogInput, runPipeline, loadConfig } = await import('@releasekit/notes');

  const config = loadConfig(options.projectDir, options.config);

  const input = versionOutputToChangelogInput(versionOutput);
  const result = await runPipeline(input, config, options.dryRun);

  return { packageNotes: result.packageNotes, releaseNotes: result.releaseNotes, files: result.files };
}

async function runPublishStep(
  versionOutput: VersionOutput,
  options: ReleaseOptions,
  releaseNotes?: Record<string, string>,
  additionalFiles?: string[],
) {
  const { runPipeline, loadConfig } = await import('@releasekit/publish');

  const config = loadConfig({ configPath: options.config });

  if (options.branch) {
    config.git.branch = options.branch;
  }

  const publishOptions = {
    dryRun: options.dryRun,
    registry: 'all' as const,
    npmAuth: options.npmAuth ?? 'auto',
    skipGit: options.skipGit,
    skipPublish: false,
    skipGithubRelease: options.skipGithubRelease,
    skipVerification: options.skipVerification,
    json: options.json,
    verbose: options.verbose,
    releaseNotes,
    additionalFiles,
  };

  return runPipeline(versionOutput, config, publishOptions);
}
