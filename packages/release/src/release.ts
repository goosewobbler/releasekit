import type { VersionOutput } from '@releasekit/core';
import { info, setJsonMode, setLogLevel, setQuietMode, success } from '@releasekit/core';
import type { ReleaseType } from 'semver';
import type { ReleaseOptions, ReleaseOutput } from './types.js';

export async function runRelease(options: ReleaseOptions): Promise<ReleaseOutput | null> {
  if (options.verbose) setLogLevel('debug');
  if (options.quiet) setQuietMode(true);
  if (options.json) setJsonMode(true);

  // --- Step 1: Version ---
  // Writes version bumps to disk but does NOT commit or tag.
  // Git operations are handled by the publish step's git-commit stage.
  info('Running version analysis...');
  const versionOutput = await runVersionStep(options);

  if (versionOutput.updates.length === 0) {
    info('No releasable changes found');
    return null;
  }

  info(`Found ${versionOutput.updates.length} package update(s)`);
  for (const update of versionOutput.updates) {
    info(`  ${update.packageName} → ${update.newVersion}`);
  }

  // --- Step 2: Notes ---
  let notesGenerated = false;
  let packageNotes: Record<string, string> | undefined;
  let notesFiles: string[] = [];
  if (!options.skipNotes) {
    info('Generating release notes...');
    const notesResult = await runNotesStep(versionOutput, options);
    packageNotes = notesResult.packageNotes;
    notesFiles = notesResult.files;
    notesGenerated = true;
    success('Release notes generated');
  }

  // --- Step 3: Publish ---
  // The publish step's git-commit stage commits version bumps + changelogs + tags.
  let publishOutput: ReleaseOutput['publishOutput'];
  if (!options.skipPublish) {
    info('Publishing...');
    publishOutput = await runPublishStep(versionOutput, options, packageNotes, notesFiles);
    success('Publish complete');
  }

  return { versionOutput, notesGenerated, packageNotes, publishOutput };
}

async function runVersionStep(options: ReleaseOptions): Promise<VersionOutput> {
  const { loadConfig, VersionEngine, enableJsonOutput, getJsonData } = await import('@releasekit/version');

  enableJsonOutput(options.dryRun);

  const config = loadConfig({ cwd: options.projectDir, configPath: options.config });

  if (options.dryRun) config.dryRun = true;
  if (options.sync) config.sync = true;
  if (options.bump) config.type = options.bump as ReleaseType;
  if (options.prerelease) {
    config.prereleaseIdentifier = options.prerelease === true ? 'next' : options.prerelease;
    config.isPrerelease = true;
  }

  const cliTargets: string[] = options.target ? options.target.split(',').map((t) => t.trim()) : [];
  if (cliTargets.length > 0) {
    config.packages = cliTargets;
  }

  const engine = new VersionEngine(config);
  const pkgsResult = await engine.getWorkspacePackages();
  const resolvedCount = pkgsResult.packages.length;

  if (resolvedCount === 0) {
    throw new Error('No packages found in workspace');
  }

  if (config.sync) {
    engine.setStrategy('sync');
    await engine.run(pkgsResult);
  } else if (resolvedCount === 1) {
    engine.setStrategy('single');
    await engine.run(pkgsResult);
  } else {
    engine.setStrategy('async');
    await engine.run(pkgsResult, cliTargets);
  }

  return getJsonData() as VersionOutput;
}

interface NotesStepResult {
  packageNotes: Record<string, string>;
  files: string[];
}

async function runNotesStep(versionOutput: VersionOutput, options: ReleaseOptions): Promise<NotesStepResult> {
  const { parseVersionOutput, runPipeline, loadConfig, getDefaultConfig } = await import('@releasekit/notes');

  const config = loadConfig(options.projectDir, options.config);

  if (config.output.length === 0) {
    config.output = getDefaultConfig().output;
  }

  const input = parseVersionOutput(JSON.stringify(versionOutput));
  const result = await runPipeline(input, config, options.dryRun);

  return { packageNotes: result.packageNotes, files: result.files };
}

async function runPublishStep(
  versionOutput: VersionOutput,
  options: ReleaseOptions,
  releaseNotes?: Record<string, string>,
  additionalFiles?: string[],
) {
  const { runPipeline, loadConfig } = await import('@releasekit/publish');

  const config = loadConfig({ configPath: options.config });

  const publishOptions = {
    dryRun: options.dryRun,
    registry: 'all' as const,
    npmAuth: 'auto' as const,
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
