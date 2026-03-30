import type { VersionPackageChangelog } from '@releasekit/core';
import { debug, info, success, warn } from '@releasekit/core';
import type { GitHubReleaseResult, PipelineContext } from '../types.js';
import { execCommand } from '../utils/exec.js';
import { isPrerelease } from '../utils/semver.js';

type BodySource = 'auto' | 'releaseNotes' | 'changelog' | 'generated' | 'none';

/**
 * Resolve notes for a given tag based on the `body` config.
 *
 * Resolution order for 'auto':
 *   1. If releaseNotes enabled in notes config → use in-memory release notes from pipeline
 *   2. If changelog enabled → use per-package changelog entries from version output
 *   3. GitHub's auto-generated notes (--generate-notes flag)
 *
 * Other values:
 *   'releaseNotes' → use in-memory release notes from pipeline (error if not enabled)
 *   'changelog'    → use changelog entries from version output
 *   'github'       → always --generate-notes
 *   'none'         → no notes body
 */
function resolveNotes(
  bodySource: BodySource,
  tag: string,
  changelogs: VersionPackageChangelog[],
  releaseNotesEnabled: boolean,
  pipelineNotes?: Record<string, string>,
): { body?: string; useGithubNotes: boolean } {
  if (bodySource === 'none') {
    return { useGithubNotes: false };
  }

  if (bodySource === 'generated') {
    return { useGithubNotes: true };
  }

  if (bodySource === 'releaseNotes') {
    if (!releaseNotesEnabled) {
      warn('releaseNotes is not enabled in notes config but body is set to releaseNotes');
      return { useGithubNotes: true };
    }
    if (pipelineNotes) {
      const body = findNotesForTag(tag, pipelineNotes);
      if (body) return { body, useGithubNotes: false };
    }
    warn('No release notes found in pipeline output, falling back to GitHub auto-notes');
    return { useGithubNotes: true };
  }

  if (bodySource === 'changelog') {
    const packageBody = formatChangelogForTag(tag, changelogs);
    if (packageBody) {
      return { body: packageBody, useGithubNotes: false };
    }
    warn('No changelog found for tag, falling back to GitHub auto-notes');
    return { useGithubNotes: true };
  }

  // 'auto' mode — layered fallback

  // 1. Try in-memory release notes from the notes pipeline
  if (releaseNotesEnabled && pipelineNotes) {
    const body = findNotesForTag(tag, pipelineNotes);
    if (body) return { body, useGithubNotes: false };
  }

  // 2. Try per-package changelog from version output
  const packageBody = formatChangelogForTag(tag, changelogs);
  if (packageBody) {
    return { body: packageBody, useGithubNotes: false };
  }

  // 3. Fall back to GitHub auto-notes
  return { useGithubNotes: true };
}

/** Check if a tag is version-only (e.g., "v1.0.0") vs package-specific (e.g., "pkg@v1.0.0"). */
function isVersionOnlyTag(tag: string): boolean {
  return /^v?\d+\.\d+\.\d+/.test(tag);
}

/** Extract title from tag for GitHub release name.
 * - Package-specific (e.g., "@releasekit/release@v0.3.0") → "@releasekit/release @ v0.3.0"
 * - Version-only (e.g., "v0.3.0") → "v0.3.0"
 */
function getTitleFromTag(tag: string): string {
  const atIndex = tag.lastIndexOf('@');
  if (atIndex === -1) {
    return tag;
  }
  const packageName = tag.slice(0, atIndex);
  const version = tag.slice(atIndex + 1);
  return `${packageName} @ ${version}`;
}

/** Match a tag to a package name in the notes map. */
function findNotesForTag(tag: string, notes: Record<string, string>): string | undefined {
  // Boundary-aware match: tag format is "packageName@vX.Y.Z"
  for (const [packageName, body] of Object.entries(notes)) {
    if (tag.startsWith(`${packageName}@`) && body.trim()) {
      return body;
    }
  }
  // Single-package fallback: only for version-only tags (e.g., "v1.0.0")
  // not for package-specific tags (e.g., "pkg@v1.0.0", "@scope/pkg@v1.0.0")
  const entries = Object.values(notes).filter((b) => b.trim());
  if (entries.length === 1 && isVersionOnlyTag(tag)) return entries[0];
  return undefined;
}

/**
 * Extract the package name from a tag (e.g., '@releasekit/version@v0.2.0' → '@releasekit/version')
 * and format that package's changelog entries into markdown.
 */
function formatChangelogForTag(tag: string, changelogs: VersionPackageChangelog[]): string | undefined {
  if (changelogs.length === 0) return undefined;

  // Try to match tag to a package changelog (boundary-aware: "packageName@vX.Y.Z")
  const changelog = changelogs.find((c) => tag.startsWith(`${c.packageName}@`));

  // For single-package repos with version-only tags, use the first changelog
  const target = changelog ?? (changelogs.length === 1 && isVersionOnlyTag(tag) ? changelogs[0] : undefined);
  if (!target || target.entries.length === 0) return undefined;

  const lines: string[] = [];
  for (const entry of target.entries) {
    const scope = entry.scope ? `**${entry.scope}:** ` : '';
    lines.push(`- ${scope}${entry.description}`);
  }
  return lines.join('\n');
}

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

  const firstTag = tags[0];
  if (!firstTag) return;
  const tagsToRelease = config.githubRelease.perPackage ? tags : [firstTag];

  for (const tag of tagsToRelease) {
    // Determine if this is a pre-release
    // Limit tag length and use safer regex to prevent ReDoS
    const MAX_TAG_LENGTH = 1000;
    const truncatedTag = tag.length > MAX_TAG_LENGTH ? tag.slice(0, MAX_TAG_LENGTH) : tag;
    const versionMatch = truncatedTag.match(/(\d{1,20}\.\d{1,20}\.\d{1,20}(?:[-+.]?[a-zA-Z0-9.-]{0,100})?)$/);
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
    ghArgs.push('--title', getTitleFromTag(tag));

    if (config.githubRelease.draft) {
      ghArgs.push('--draft');
    }

    if (isPreRel) {
      ghArgs.push('--prerelease');
    }

    // Resolve notes for this tag
    // releaseNotesEnabled = whether we have any release notes content from the notes pipeline
    const releaseNotesEnabled = !!(ctx.releaseNotes && Object.keys(ctx.releaseNotes).length > 0);
    const { body, useGithubNotes } = resolveNotes(
      config.githubRelease.body,
      tag,
      ctx.input.changelogs,
      releaseNotesEnabled,
      ctx.releaseNotes,
    );
    if (body) {
      ghArgs.push('--notes', body);
    } else if (useGithubNotes) {
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
