import type { Preset } from '@releasekit/config';
import type { VersionChangelogEntry } from '@releasekit/core';
import { createGitCli, type Git } from '@releasekit/git';
import { CommitParser } from 'conventional-commits-parser';
import { createPreset } from '../core/presets.js';
import { log } from '../utils/logging.js';

type ChangelogEntry = VersionChangelogEntry;

// Non-conventional version-bump bookkeeping subjects (e.g. `Update version to 1.2.3`). Narrow by
// construction so a real change like "update version handling in the parser" is never swallowed.
const VERSION_BUMP_SUBJECT_REGEX = /^update (?:version to v?\d|package versions)\b/i;
/** Reserved for release commits, which record a release rather than a change. */
const RELEASE_COMMIT_PREFIX = 'chore: release ';

export interface CommitWithHash {
  hash: string;
  entry: ChangelogEntry;
}

export async function extractAllChangelogEntriesWithHash(
  projectDir: string,
  revisionRange: string,
  preset: Preset,
  git: Git = createGitCli(),
): Promise<CommitWithHash[]> {
  try {
    // No path filter - repo-wide history (used to classify repo-level vs package commits).
    const output = await git.log({
      range: revisionRange,
      format: '%H|||%B---COMMIT_DELIMITER---',
      extraArgs: ['--no-merges'],
      cwd: projectDir,
    });

    const commits = output.split('---COMMIT_DELIMITER---').filter((commit) => commit.trim() !== '');

    return commits
      .map((commit) => {
        const [hash, ...messageParts] = commit.split('|||');
        const message = messageParts.join('|||').trim();
        const entry = parseCommitMessage(message, preset);
        if (entry && hash) {
          return { hash: hash.trim(), entry };
        }
        return null;
      })
      .filter((item): item is CommitWithHash => item !== null);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log(`Error extracting all commits with hash: ${errorMessage}`, 'error');
    return [];
  }
}

/** Entries from commits that change nothing under `packageDirs`, the pathspecs every non-shared package owns. */
export async function extractRepoLevelChangelogEntries(
  projectDir: string,
  revisionRange: string,
  preset: Preset,
  packageDirs: string[],
  git: Git = createGitCli(),
): Promise<ChangelogEntry[]> {
  try {
    const allCommits = await extractAllChangelogEntriesWithHash(projectDir, revisionRange, preset, git);
    if (packageDirs.length === 0) {
      return allCommits.map((c) => c.entry);
    }

    const packageCommits = await git.log({
      range: revisionRange,
      format: '%H',
      // Without `--full-history`, history simplification hides a side branch whose merge leaves a package unchanged.
      extraArgs: ['--no-merges', '--full-history'],
      paths: packageDirs,
      cwd: projectDir,
    });
    const packageHashes = new Set(packageCommits.split('\n').map((line) => line.trim()));
    const repoLevelCommits = allCommits.filter((commit) => !packageHashes.has(commit.hash));

    if (repoLevelCommits.length > 0) {
      log(`Found ${repoLevelCommits.length} repo-level commit(s)`, 'debug');
    }

    return repoLevelCommits.map((c) => c.entry);
  } catch (error) {
    log(`Error extracting repo-level commits: ${error instanceof Error ? error.message : String(error)}`, 'warning');
    return [];
  }
}

/** `paths` are pathspecs, relative to `projectDir` or absolute. */
export async function extractChangelogEntriesFromCommits(
  projectDir: string,
  revisionRange: string,
  preset: Preset,
  paths: string[] = ['.'],
  git: Git = createGitCli(),
): Promise<ChangelogEntry[]> {
  try {
    const output = await git.log({
      range: revisionRange,
      format: '%B---COMMIT_DELIMITER---',
      extraArgs: ['--no-merges'],
      paths,
      cwd: projectDir,
    });

    const commits = output.split('---COMMIT_DELIMITER---').filter((commit) => commit.trim() !== '');

    return commits
      .map((commit) => parseCommitMessage(commit, preset))
      .filter((entry): entry is ChangelogEntry => entry !== null);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (errorMessage.includes('ambiguous argument') && errorMessage.includes('unknown revision')) {
      const tagName = revisionRange.split('..')[0] || revisionRange;

      if (tagName.startsWith('v') && !tagName.includes('@')) {
        log(
          `Error: Tag "${tagName}" not found. If you're using package-specific tags (like "package-name@v1.0.0"), you may need to configure "tagTemplate" in your releasekit.config.json to use: \${packageName}@\${prefix}\${version}`,
          'error',
        );
      } else {
        log(
          `Error: Tag or revision "${tagName}" not found in the repository. Please check if this tag exists or if you need to fetch it from the remote.`,
          'error',
        );
      }
    } else {
      log(`Error extracting commits: ${errorMessage}`, 'error');
    }

    return [];
  }
}

const parsers = new Map<Preset, CommitParser>();

function parserFor(preset: Preset): CommitParser {
  let parser = parsers.get(preset);
  if (!parser) {
    parser = new CommitParser(createPreset(preset).parser);
    parsers.set(preset, parser);
  }
  return parser;
}

function parseCommitMessage(message: string, preset: Preset): ChangelogEntry | null {
  const trimmedMessage = message.trim();
  if (!trimmedMessage || trimmedMessage.startsWith(RELEASE_COMMIT_PREFIX)) {
    return null;
  }

  const commit = parserFor(preset).parse(trimmedMessage);
  const { type, scope, subject } = commit;

  if (type) {
    const body = trimmedMessage.split('\n').slice(1).join('\n');
    const changelogType = mapCommitTypeToChangelogType(type);

    // GitHub appends `(#N)` to squash-merge subjects. Pull it off so it renders as a labelled PR ref rather
    // than an autolink GitHub expands into a rich card, and so the changelog can tell PR from closed issue.
    const subjectRaw = subject ?? '';
    const prMatch = subjectRaw.match(/\s*\(#(\d+)\)\s*$/);
    const prNumber = prMatch ? `#${prMatch[1]}` : undefined;
    const subjectText = prMatch ? subjectRaw.slice(0, prMatch.index).trimEnd() : subjectRaw;

    // eslint-disable-next-line local/no-bare-issue-refs -- the "Fixes" footer example on the next line is a format sample, not a citation
    // issueIds (from footers like "Fixes #123") also includes the PR, so a consumer that ignores
    // prNumber still shows every ref.
    const bodyIssueIds = extractIssueIds(body);
    const issueIds = [...new Set(prNumber ? [prNumber, ...bodyIssueIds] : bodyIssueIds)];

    return {
      type: changelogType,
      description: subjectText,
      scope: scope || undefined,
      issueIds: issueIds.length > 0 ? issueIds : undefined,
      prNumber,
      // Every note keyword is a breaking one, and the parser adds a note for a `!` header.
      ...(commit.notes.length > 0 && { breaking: true }),
      originalType: type,
    };
  }

  if (
    !trimmedMessage.startsWith('Merge') &&
    !trimmedMessage.match(/^v?\d+\.\d+\.\d+/) &&
    !VERSION_BUMP_SUBJECT_REGEX.test(trimmedMessage)
  ) {
    const firstLine = trimmedMessage.split('\n')[0].trim();
    return {
      type: 'changed',
      description: firstLine,
    };
  }

  return null;
}

function mapCommitTypeToChangelogType(type: string): ChangelogEntry['type'] {
  switch (type) {
    case 'feat':
      return 'added';
    case 'fix':
      return 'fixed';
    case 'docs':
    case 'style':
    case 'refactor':
    case 'perf':
    case 'build':
    case 'ci':
      return 'changed';
    case 'revert':
      return 'removed';
    case 'chore':
      return 'changed';
    case 'test':
      // Not dropped: every merged change is listed (low-signal ones are demoted, not hidden).
      return 'changed';
    default:
      return 'changed';
  }
}

function extractIssueIds(body: string): string[] {
  // GitHub's closing keywords. Not the parser's references: its action covers every ref after the keyword on the line.
  const issueRegex = /(?<![\w-])(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?):?[ \t]+#(\d+)/gi;
  const issueIds: string[] = [];

  let match: RegExpExecArray | null = issueRegex.exec(body);
  while (match !== null) {
    issueIds.push(`#${match[1]}`);
    match = issueRegex.exec(body);
  }

  return issueIds;
}
