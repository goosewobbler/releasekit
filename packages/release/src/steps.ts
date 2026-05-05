import type { VersionOutput } from '@releasekit/core';
import type { ReleaseOptions, ReleaseOutput } from './types.js';

export interface NotesStepResult {
  packageNotes: Record<string, string>;
  releaseNotes?: Record<string, string>;
  files: string[];
}

export async function runVersionStep(options: ReleaseOptions): Promise<VersionOutput> {
  const { loadConfig, VersionEngine, enableJsonOutput, getJsonData } = await import('@releasekit/version');

  enableJsonOutput(options.dryRun);

  const config = loadConfig({ cwd: options.projectDir, configPath: options.config });

  const targets: string[] = options.target ? options.target.split(',').map((t) => t.trim()) : [];

  const runOptions = {
    bump: options.bump as import('semver').ReleaseType | undefined,
    prerelease: options.prerelease,
    stable: options.stable,
    dryRun: options.dryRun,
    sync: options.sync,
    targets,
    baseRef: options.baseRef,
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

export async function runNotesStep(versionOutput: VersionOutput, options: ReleaseOptions): Promise<NotesStepResult> {
  const { versionOutputToChangelogInput, runPipeline, loadConfig } = await import('@releasekit/notes');

  const config = loadConfig(options.projectDir, options.config);

  const input = versionOutputToChangelogInput(versionOutput);
  const result = await runPipeline(input, config, options.dryRun);

  return { packageNotes: result.packageNotes, releaseNotes: result.releaseNotes, files: result.files };
}

export async function runPublishStep(
  versionOutput: VersionOutput,
  options: ReleaseOptions,
  releaseNotes?: Record<string, string>,
  additionalFiles?: string[],
): Promise<ReleaseOutput['publishOutput']> {
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
    skipGitCommit: options.skipGitCommit,
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
