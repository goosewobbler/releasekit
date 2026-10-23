import type { VersionPackageChangelog } from '@releasekit/core';
import { assertNotOption, debug, info, sanitizePackageName, success, warn } from '@releasekit/core';
import type { GitHubReleaseResult, PipelineContext } from '../types.js';
import { execCommand, execCommandSafe } from '../utils/exec.js';
import { isPrerelease } from '../utils/semver.js';

type BodySource = 'auto' | 'releaseNotes' | 'changelog' | 'generated' | 'none';

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
      if (body) {
        return { body, useGithubNotes: false };
      }
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

  // 'auto'
  if (releaseNotesEnabled && pipelineNotes) {
    const body = findNotesForTag(tag, pipelineNotes);
    if (body) {
      return { body, useGithubNotes: false };
    }
    warn(`Release notes configured but no content found for tag ${tag}, falling back to GitHub auto-generated notes`);
  }

  return { useGithubNotes: true };
}

function isVersionOnlyTag(tag: string): boolean {
  return /^v?\d+\.\d+\.\d+/.test(tag);
}

interface TagResolution {
  packageName: string;
  version: string;
}

function resolveTagPackage(tag: string, packageNames: string[]): TagResolution | null {
  // Longest sanitized name first, to resolve prefix ambiguity.
  const sorted = [...packageNames].sort((a, b) => sanitizePackageName(b).length - sanitizePackageName(a).length);
  for (const packageName of sorted) {
    // Raw, unsanitized name: "@scope/pkg@v1.0.0"
    const atPrefix = `${packageName}@`;
    if (tag.startsWith(atPrefix)) {
      return { packageName, version: tag.slice(atPrefix.length) };
    }
    const sanitized = sanitizePackageName(packageName);
    // Sanitized name, "@" separator: "scope-pkg@v1.0.0", from tagTemplate "${packageName}@v${version}" on a
    // scoped name. Unscoped names collapse to `atPrefix` above.
    const sanitizedAtPrefix = `${sanitized}@`;
    if (sanitizedAtPrefix !== atPrefix && tag.startsWith(sanitizedAtPrefix)) {
      const versionPart = tag.slice(sanitizedAtPrefix.length);
      if (/^v?\d/.test(versionPart)) {
        return { packageName, version: versionPart };
      }
    }
    // Sanitized name, "-" separator: "scope-pkg-v1.0.0"
    const dashPrefix = `${sanitized}-`;
    if (tag.startsWith(dashPrefix)) {
      const versionPart = tag.slice(dashPrefix.length);
      if (/^v?\d/.test(versionPart)) {
        return { packageName, version: versionPart };
      }
    }
  }
  return null;
}

/** Titles use the unsanitized package name, e.g. "releasekit-version-v0.4.1" → "@releasekit/version: v0.4.1". */
function getTitleFromTag(tag: string, packageNames: string[], titleTemplate: string): string {
  const applyTemplate = (packageName: string, version: string): string =>
    titleTemplate.replace(/\$\{packageName\}/g, packageName).replace(/\$\{version\}/g, version);

  if (packageNames.length > 0) {
    const resolved = resolveTagPackage(tag, packageNames);
    if (resolved) {
      return applyTemplate(resolved.packageName, resolved.version);
    }
  }
  const atIndex = tag.lastIndexOf('@');
  if (atIndex === -1) {
    return tag;
  }
  return applyTemplate(tag.slice(0, atIndex), tag.slice(atIndex + 1));
}

function findNotesForTag(tag: string, notes: Record<string, string>): string | undefined {
  const resolved = resolveTagPackage(tag, Object.keys(notes));
  if (resolved) {
    const body = notes[resolved.packageName];
    if (body?.trim()) {
      return body;
    }
  }
  const entries = Object.values(notes).filter((b) => b.trim());
  if (entries.length === 1 && isVersionOnlyTag(tag)) {
    return entries[0];
  }
  return undefined;
}

function formatChangelogForTag(tag: string, changelogs: VersionPackageChangelog[]): string | undefined {
  if (changelogs.length === 0) {
    return undefined;
  }

  const resolved = resolveTagPackage(
    tag,
    changelogs.map((c) => c.packageName),
  );

  let target: VersionPackageChangelog | undefined;
  if (resolved) {
    target = changelogs.find((c) => c.packageName === resolved.packageName);
  } else if (changelogs.length === 1 && isVersionOnlyTag(tag)) {
    target = changelogs[0];
  }

  if (!target || target.entries.length === 0) {
    return undefined;
  }

  const lines: string[] = [];
  for (const entry of target.entries) {
    const scope = entry.scope ? `**${entry.scope}:** ` : '';
    lines.push(`- ${entry.breaking ? '**BREAKING** ' : ''}${scope}${entry.description}`);
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

  // Baseline tags are pushed alongside consumer tags but are an internal source-branch marker, not a release
  // point. ctx.input.tags covers callers that bypass the git-commit stage and don't populate output.git.tags.
  const baselineSet = new Set(ctx.input.baselineTags ?? []);
  const candidateTags = output.git.tags.length > 0 ? output.git.tags : ctx.input.tags;
  const tags = candidateTags.filter((tag) => !baselineSet.has(tag));

  if (tags.length === 0) {
    info('No tags available for GitHub release');
    return;
  }

  const firstTag = tags[0];
  if (!firstTag) {
    return;
  }
  const tagsToRelease = config.githubRelease.perPackage ? tags : [firstTag];

  const skipPackages = config.githubRelease.skipPackages ?? [];

  for (const tag of tagsToRelease) {
    // Defense-in-depth against argument injection: the git stage already rejects a leading `-`, but a
    // `-`-prefixed tag must never reach the `gh` argv, where cobra would parse it as a flag (e.g. -R/--repo).
    try {
      assertNotOption(tag, 'tag');
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      warn(`Failed to create GitHub release for ${tag}: ${reason}`);
      ctx.output.githubReleases.push({
        tag,
        draft: config.githubRelease.draft,
        prerelease: false,
        success: false,
        reason,
      });
      continue;
    }

    // Tags are still created (the next release's changelog range needs them) and npm publish still runs.
    if (skipPackages.length > 0) {
      const resolved = resolveTagPackage(tag, skipPackages);
      if (resolved) {
        debug(`Skipping GitHub release for ${resolved.packageName} (listed in githubRelease.skipPackages)`);
        continue;
      }
    }

    // Bounded length and quantifiers guard against ReDoS.
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
    const titlePackageNames = [
      ...ctx.input.changelogs.map((c) => c.packageName),
      ...(ctx.releaseNotes ? Object.keys(ctx.releaseNotes) : []),
    ];
    ghArgs.push('--title', getTitleFromTag(tag, [...new Set(titlePackageNames)], config.githubRelease.titleTemplate));

    if (config.githubRelease.draft) {
      ghArgs.push('--draft');
    }

    if (isPreRel) {
      ghArgs.push('--prerelease');
    }

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

    // Leave an existing release alone so re-runs stay idempotent.
    if (!dryRun) {
      const viewResult = await execCommandSafe('gh', ['release', 'view', tag], { dryRun: false });
      if (viewResult.exitCode === 0) {
        info(`GitHub release for ${tag} already exists, skipping`);
        result.success = true;
        ctx.output.githubReleases.push(result);
        continue;
      }
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
