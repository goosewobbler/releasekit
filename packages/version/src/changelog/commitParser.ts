import type { VersionChangelogEntry } from '@releasekit/core';
import { createGitCli, type Git } from '@releasekit/git';
import { log } from '../utils/logging.js';

type ChangelogEntry = VersionChangelogEntry;

const CONVENTIONAL_COMMIT_REGEX = /^(\w+)(?:\(([^)]+)\))?(!)?: (.+)(?:\n\n([\s\S]*))?/;
const BREAKING_CHANGE_REGEX = /BREAKING CHANGE: ([\s\S]+?)(?:\n\n|$)/;
// Non-conventional version-bump bookkeeping subjects (e.g. `Update version to 1.2.3`). Narrow by
// construction so a real change like "update version handling in the parser" is never swallowed.
const VERSION_BUMP_SUBJECT_REGEX = /^update (?:version to v?\d|package versions)\b/i;

export interface CommitWithHash {
  hash: string;
  entry: ChangelogEntry;
}

export async function extractChangelogEntriesWithHash(
  projectDir: string,
  revisionRange: string,
  git: Git = createGitCli(),
): Promise<CommitWithHash[]> {
  try {
    const output = await git.log({
      range: revisionRange,
      format: '%H|||%B---COMMIT_DELIMITER---',
      extraArgs: ['--no-merges'],
      paths: ['.'],
      cwd: projectDir,
    });

    const commits = output.split('---COMMIT_DELIMITER---').filter((commit) => commit.trim() !== '');

    return commits
      .map((commit) => {
        const [hash, ...messageParts] = commit.split('|||');
        const message = messageParts.join('|||').trim();
        const entry = parseCommitMessage(message);
        if (entry && hash) {
          return { hash: hash.trim(), entry };
        }
        return null;
      })
      .filter((item): item is CommitWithHash => item !== null);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log(`Error extracting commits with hash: ${errorMessage}`, 'error');
    return [];
  }
}

export async function extractAllChangelogEntriesWithHash(
  projectDir: string,
  revisionRange: string,
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
        const entry = parseCommitMessage(message);
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

/** Shared package directories count as repo-level, so touching only those returns false. */
export async function commitTouchesAnyPackage(
  projectDir: string,
  commitHash: string,
  packageDirs: string[],
  sharedPackageDirs: string[] = [],
  git: Git = createGitCli(),
): Promise<boolean> {
  try {
    const changedFiles = await git.diffTreeNames(commitHash, projectDir);

    if (changedFiles.length === 0) {
      return false;
    }

    return changedFiles.some((file) => {
      return packageDirs.some((pkgDir) => {
        if (sharedPackageDirs.some((sharedDir) => pkgDir.includes(sharedDir))) {
          return false;
        }
        const normalizedFile = file.replace(/\\/g, '/');
        const normalizedPkgDir = pkgDir.replace(/\\/g, '/').replace(/^\.\//, '');
        return normalizedFile.startsWith(normalizedPkgDir);
      });
    });
  } catch (error) {
    log(
      `Error checking if commit ${commitHash} touches packages: ${error instanceof Error ? error.message : String(error)}`,
      'debug',
    );
    return false;
  }
}

export async function extractRepoLevelChangelogEntries(
  projectDir: string,
  revisionRange: string,
  packageDirs: string[],
  sharedPackageDirs: string[] = [],
  git: Git = createGitCli(),
): Promise<ChangelogEntry[]> {
  try {
    const allCommits = await extractAllChangelogEntriesWithHash(projectDir, revisionRange, git);

    const touches = await Promise.all(
      allCommits.map((commit) => commitTouchesAnyPackage(projectDir, commit.hash, packageDirs, sharedPackageDirs, git)),
    );
    const repoLevelCommits = allCommits.filter((_commit, i) => !touches[i]);

    if (repoLevelCommits.length > 0) {
      log(
        `Found ${repoLevelCommits.length} repo-level commit(s) (including shared packages: ${sharedPackageDirs.join(', ')})`,
        'debug',
      );
    }

    return repoLevelCommits.map((c) => c.entry);
  } catch (error) {
    log(`Error extracting repo-level commits: ${error instanceof Error ? error.message : String(error)}`, 'warning');
    return [];
  }
}

export function extractChangelogEntriesFromCommits(
  projectDir: string,
  revisionRange: string,
  git: Git = createGitCli(),
): Promise<ChangelogEntry[]> {
  return extractCommitsFromGitLog(projectDir, revisionRange, true, git);
}

/** Repo-wide: not filtered to commits touching `projectDir`. */
export function extractAllChangelogEntries(
  projectDir: string,
  revisionRange: string,
  git: Git = createGitCli(),
): Promise<ChangelogEntry[]> {
  return extractCommitsFromGitLog(projectDir, revisionRange, false, git);
}

async function extractCommitsFromGitLog(
  projectDir: string,
  revisionRange: string,
  filterToPath: boolean,
  git: Git = createGitCli(),
): Promise<ChangelogEntry[]> {
  try {
    const output = await git.log({
      range: revisionRange,
      format: '%B---COMMIT_DELIMITER---',
      extraArgs: ['--no-merges'],
      paths: filterToPath ? ['.'] : undefined,
      cwd: projectDir,
    });

    const commits = output.split('---COMMIT_DELIMITER---').filter((commit) => commit.trim() !== '');

    return commits
      .map((commit) => parseCommitMessage(commit))
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

function parseCommitMessage(message: string): ChangelogEntry | null {
  const trimmedMessage = message.trim();

  const match = trimmedMessage.match(CONVENTIONAL_COMMIT_REGEX);

  if (match) {
    const [, type, scope, breakingMark, subject, body = ''] = match;

    const breakingFromMark = breakingMark === '!';
    const breakingChangeMatch = body.match(BREAKING_CHANGE_REGEX);
    const hasBreakingChange = breakingFromMark || breakingChangeMatch !== null;

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
    const issueIds = prNumber ? [prNumber, ...bodyIssueIds] : bodyIssueIds;

    return {
      type: changelogType,
      description: subjectText,
      scope: scope || undefined,
      issueIds: issueIds.length > 0 ? issueIds : undefined,
      prNumber,
      ...(hasBreakingChange && { breaking: true }),
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
  const issueRegex = /(?:fix|fixes|close|closes|resolve|resolves)\s+#(\d+)/gi;
  const issueIds: string[] = [];

  let match: RegExpExecArray | null = issueRegex.exec(body);
  while (match !== null) {
    issueIds.push(`#${match[1]}`);
    match = issueRegex.exec(body);
  }

  return issueIds;
}
