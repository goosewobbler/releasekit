import type { VersionOutput, VersionPackageUpdate } from '@releasekit/core';
import { assertNotOption, debug, info, matchesPackageName, sanitizePackageName, success, warn } from '@releasekit/core';
import type { GitHubReleaseResult, PipelineContext } from '../types.js';
import { execCommand, execCommandSafe } from '../utils/exec.js';
import { isPrerelease } from '../utils/semver.js';

type BodySource = 'auto' | 'releaseNotes' | 'changelog' | 'generated' | 'none';

interface ReleaseTag {
  tag: string;
  /** The update that carries the tag, when only one does. */
  owner?: VersionPackageUpdate;
  /** A sync release's tag, or one several updates carry. */
  shared: boolean;
  input: VersionOutput;
}

function resolveNotes(
  bodySource: BodySource,
  release: ReleaseTag,
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
      const body = findNotesForTag(release, pipelineNotes);
      if (body) {
        return { body, useGithubNotes: false };
      }
    }
    warn(`No release notes found for tag ${release.tag}, falling back to GitHub auto-generated notes`);
    return { useGithubNotes: true };
  }

  if (bodySource === 'changelog') {
    const packageBody = formatChangelogForTag(release);
    if (packageBody) {
      return { body: packageBody, useGithubNotes: false };
    }
    warn(`No changelog found for tag ${release.tag}, falling back to GitHub auto-generated notes`);
    return { useGithubNotes: true };
  }

  // 'auto'
  if (releaseNotesEnabled && pipelineNotes) {
    const body = findNotesForTag(release, pipelineNotes);
    if (body) {
      return { body, useGithubNotes: false };
    }
    warn(
      `Release notes configured but no content found for tag ${release.tag}, falling back to GitHub auto-generated notes`,
    );
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
      if (isVersionOnlyTag(versionPart)) {
        return { packageName, version: versionPart };
      }
    }
    // Sanitized name, "-" separator: "scope-pkg-v1.0.0"
    const dashPrefix = `${sanitized}-`;
    if (tag.startsWith(dashPrefix)) {
      const versionPart = tag.slice(dashPrefix.length);
      if (isVersionOnlyTag(versionPart)) {
        return { packageName, version: versionPart };
      }
    }
  }
  return null;
}

function startsWithPackageName(tag: string, packageName: string): boolean {
  return [packageName, sanitizePackageName(packageName)].some(
    (name) => tag.startsWith(name) && /^[^a-z0-9]/i.test(tag.slice(name.length)),
  );
}

/** Titles use the unsanitized package name, e.g. "releasekit-version-v0.4.1" → "@releasekit/version: v0.4.1". */
function getTitleFromTag(
  tag: string,
  owner: VersionPackageUpdate | undefined,
  packageNames: string[],
  titleTemplate: string,
): string {
  const applyTemplate = (packageName: string, version: string): string =>
    titleTemplate.replace(/\$\{packageName\}/g, packageName).replace(/\$\{version\}/g, version);

  if (owner && startsWithPackageName(tag, owner.packageName)) {
    const withV = `v${owner.newVersion}`;
    // The v must follow a separator: 'pkg-dev1.2.3' has no v prefix.
    const tagHasV = tag.endsWith(withV) && !/[a-z0-9]/i.test(tag.charAt(tag.length - withV.length - 1));
    return applyTemplate(owner.packageName, tagHasV ? withV : owner.newVersion);
  }
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

/**
 * Returns the owning update's package, else the package the tag names. A shared or version-only tag falls back to
 * the only filled key, unless that package has a different tag.
 */
function resolveTagKey(
  { tag, owner, shared, input }: ReleaseTag,
  keys: string[],
  filled: string[],
): string | undefined {
  if (owner) {
    return keys.includes(owner.packageName) ? owner.packageName : undefined;
  }
  const parsed = resolveTagPackage(tag, keys)?.packageName;
  if (parsed !== undefined) {
    return parsed;
  }
  const sole = filled.length === 1 ? filled[0] : undefined;
  if (sole === undefined || input.updates.some((u) => u.packageName === sole && u.tag && u.tag !== tag)) {
    return undefined;
  }
  return shared || isVersionOnlyTag(tag) ? sole : undefined;
}

function findNotesForTag(release: ReleaseTag, notes: Record<string, string>): string | undefined {
  const keys = Object.keys(notes);
  const key = resolveTagKey(
    release,
    keys,
    keys.filter((name) => notes[name]?.trim()),
  );
  return key === undefined || !notes[key]?.trim() ? undefined : notes[key];
}

function formatChangelogForTag(release: ReleaseTag): string | undefined {
  const { changelogs } = release.input;
  const key = resolveTagKey(
    release,
    changelogs.map((c) => c.packageName),
    changelogs.filter((c) => c.entries.length > 0).map((c) => c.packageName),
  );
  const target = changelogs.find((c) => c.packageName === key);

  if (!target || target.entries.length === 0) {
    return undefined;
  }

  const lines: string[] = [];
  const breakingFirst = [...target.entries.filter((e) => e.breaking), ...target.entries.filter((e) => !e.breaking)];
  for (const entry of breakingFirst) {
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
  const syncTag = ctx.input.updates.length > 0 && ctx.input.updates.every((u) => !u.tag);
  const titlePackageNames = [
    ...new Set([...ctx.input.changelogs.map((c) => c.packageName), ...Object.keys(ctx.releaseNotes ?? {})]),
  ];

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

    const owners = ctx.input.updates.filter((u) => u.tag === tag);
    const owner = owners.length === 1 ? owners[0] : undefined;

    // Tags are still created (the next release's changelog range needs them) and npm publish still runs.
    if (skipPackages.length > 0) {
      const skipped = owner
        ? skipPackages.find((name) => matchesPackageName(name, owner.packageName))
        : resolveTagPackage(tag, skipPackages)?.packageName;
      if (skipped) {
        debug(`Skipping GitHub release for ${skipped} (listed in githubRelease.skipPackages)`);
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
    ghArgs.push('--title', getTitleFromTag(tag, owner, titlePackageNames, config.githubRelease.titleTemplate));

    if (config.githubRelease.draft) {
      ghArgs.push('--draft');
    }

    if (isPreRel) {
      ghArgs.push('--prerelease');
    }

    const releaseNotesEnabled = !!(ctx.releaseNotes && Object.keys(ctx.releaseNotes).length > 0);
    const { body, useGithubNotes } = resolveNotes(
      config.githubRelease.body,
      { tag, owner, shared: owners.length > 1 || (owners.length === 0 && syncTag), input: ctx.input },
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
