import type { Preset } from '@releasekit/config';
import type { VersionChangelogEntry } from '@releasekit/core';
import { createGitCli, type Git } from '@releasekit/git';
import { type Commit, CommitParser } from 'conventional-commits-parser';
import { asReapplied, createPreset, filterRevertedCommits } from '../core/presets.js';
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

    return parseLog(output, preset);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log(`Error extracting all commits with hash: ${errorMessage}`, 'error');
    return [];
  }
}

async function hashesTouching(
  git: Git,
  projectDir: string,
  revisionRange: string,
  paths: string[],
): Promise<Set<string>> {
  if (paths.length === 0) {
    return new Set();
  }
  const output = await git.log({
    range: revisionRange,
    format: '%H',
    // Without `--full-history`, history simplification hides a side branch whose merge leaves the paths unchanged.
    extraArgs: ['--no-merges', '--full-history'],
    paths,
    cwd: projectDir,
  });
  return new Set(output.split('\n').map((line) => line.trim()));
}

/**
 * Entries from commits that change nothing under `packageDirs`, the pathspecs every non-shared package owns. An entry
 * whose commit changes something under `sharedPackageDirs` is marked `sharedPackage`.
 */
export async function extractRepoLevelChangelogEntries(
  projectDir: string,
  revisionRange: string,
  preset: Preset,
  packageDirs: string[],
  sharedPackageDirs: string[],
  git: Git = createGitCli(),
): Promise<ChangelogEntry[]> {
  try {
    const allCommits = await extractAllChangelogEntriesWithHash(projectDir, revisionRange, preset, git);
    const packageHashes = await hashesTouching(git, projectDir, revisionRange, packageDirs);
    const repoLevelCommits = allCommits.filter((commit) => !packageHashes.has(commit.hash));

    if (repoLevelCommits.length > 0) {
      log(`Found ${repoLevelCommits.length} repo-level commit(s)`, 'debug');
    }

    const sharedHashes = await hashesTouching(git, projectDir, revisionRange, sharedPackageDirs);
    return repoLevelCommits.map((c) => (sharedHashes.has(c.hash) ? { ...c.entry, sharedPackage: true } : c.entry));
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
      format: '%H|||%B---COMMIT_DELIMITER---',
      extraArgs: ['--no-merges'],
      paths,
      cwd: projectDir,
    });

    return parseLog(output, preset).map((c) => c.entry);
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

/** Parses `%H|||%B` log output, newest first, dropping each commit reverted in the range along with its revert. */
function parseLog(output: string, preset: Preset): CommitWithHash[] {
  const commits = output.split('---COMMIT_DELIMITER---').flatMap((raw) => {
    const [hash, ...messageParts] = raw.split('|||');
    const message = messageParts.join('|||').trim();
    if (!message) {
      return [];
    }
    return [{ hash: hash.trim(), message, commit: parserFor(preset).parse(message) }];
  });

  return filterRevertedCommits(commits, ({ hash, commit }) => ({ ...commit, hash })).flatMap(
    ({ hash, message, commit }) => {
      const entry = toChangelogEntry(message, asReapplied(commit, parserFor(preset)));
      return entry ? [{ hash, entry }] : [];
    },
  );
}

function toChangelogEntry(trimmedMessage: string, commit: Commit): ChangelogEntry | null {
  if (trimmedMessage.startsWith(RELEASE_COMMIT_PREFIX)) {
    return null;
  }

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
    const issueIds = prNumber ? [prNumber, ...bodyIssueIds] : bodyIssueIds;

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

/** Drops fenced blocks and inline code spans, where a closing keyword is quoted rather than meant. */
function stripCode(body: string): string {
  let fence: string | undefined;
  return (
    body
      .split('\n')
      .filter((line) => {
        if (fence) {
          const close = line.match(/^ {0,3}(`{3,}|~{3,})\s*$/)?.[1];
          if (close?.[0] === fence[0] && close.length >= fence.length) {
            fence = undefined;
          }
          return false;
        }
        // Backticks later on the line make it an inline span, not a fence.
        fence = line.match(/^ {0,3}(`{3,}(?=[^`]*$)|~{3,})/)?.[1];
        return !fence;
      })
      .join('\n')
      // Single-line, so a stray backtick can't swallow refs on later lines. `|` is a non-word character: it keeps
      // "closes `x` #3" from matching and the \b before a keyword that follows a span.
      .replace(/`[^`\n]*`/g, '|')
  );
}

function extractIssueIds(body: string): string[] {
  // GitHub's closing keywords. Not the parser's references: its action covers every ref after the keyword on the line.
  const issueRegex = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?):?\s+#(\d+)/gi;
  const issueIds: string[] = [];
  const prose = stripCode(body);

  let match: RegExpExecArray | null = issueRegex.exec(prose);
  while (match !== null) {
    issueIds.push(`#${match[1]}`);
    match = issueRegex.exec(prose);
  }

  return issueIds;
}
