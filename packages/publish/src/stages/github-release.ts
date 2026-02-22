import * as fs from 'node:fs';
import { debug, info, success, warn } from '@releasekit/core';
import type { GitHubReleaseResult, PipelineContext } from '../types.js';
import { execCommand } from '../utils/exec.js';
import { isPrerelease } from '../utils/semver.js';

/** Error strategy: CATCHES per-tag. Non-critical. */
export async function runGithubReleaseStage(ctx: PipelineContext): Promise<void> {
  const { config, cliOptions, output } = ctx;
  const dryRun = cliOptions.dryRun;

  if (!config.githubRelease.enabled) {
    debug('GitHub releases disabled in config');
    return;
  }

  const tags = output.git.tags.length > 0 ? output.git.tags : ctx.input.tags;

  if (tags.length === 0) {
    info('No tags available for GitHub release');
    return;
  }

  // Read notes file if provided
  let notesBody: string | undefined;
  if (config.githubRelease.notesFile) {
    try {
      notesBody = fs.readFileSync(config.githubRelease.notesFile, 'utf-8');
    } catch {
      debug(`Could not read notes file: ${config.githubRelease.notesFile}`);
    }
  }

  const firstTag = tags[0];
  if (!firstTag) return;
  const tagsToRelease = config.githubRelease.perPackage ? tags : [firstTag];

  for (const tag of tagsToRelease) {
    // Determine if this is a pre-release
    const versionMatch = tag.match(/(\d+\.\d+\.\d+.*)$/);
    const version = versionMatch?.[1] ?? '';
    const isPreRel =
      config.githubRelease.prerelease === 'auto'
        ? version
          ? isPrerelease(version)
          : false
        : config.githubRelease.prerelease;

    const result: GitHubReleaseResult = {
      tag,
      draft: config.githubRelease.draft,
      prerelease: isPreRel,
      success: false,
    };

    const ghArgs = ['release', 'create', tag];

    if (config.githubRelease.draft) {
      ghArgs.push('--draft');
    }

    if (isPreRel) {
      ghArgs.push('--prerelease');
    }

    if (notesBody) {
      ghArgs.push('--notes', notesBody);
    } else if (config.githubRelease.generateNotes) {
      ghArgs.push('--generate-notes');
    }

    try {
      const execResult = await execCommand('gh', ghArgs, {
        dryRun,
        label: `gh release create ${tag}`,
      });

      result.success = true;
      if (!dryRun && execResult.stdout.trim()) {
        result.url = execResult.stdout.trim();
      }

      if (!dryRun) {
        success(`Created GitHub release for ${tag}`);
      }
    } catch (error) {
      result.reason = error instanceof Error ? error.message : String(error);
      warn(`Failed to create GitHub release for ${tag}: ${result.reason}`);
    }

    ctx.output.githubReleases.push(result);
  }
}
