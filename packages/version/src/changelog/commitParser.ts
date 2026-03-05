/**
 * Commit Parser
 *
 * Extracts changelog entries from git commit messages
 */

import type { VersionChangelogEntry } from '@releasekit/core';
import { execSync } from '../git/commandExecutor.js';
import { log } from '../utils/logging.js';

type ChangelogEntry = VersionChangelogEntry;

// Regular expression to parse conventional commit messages
const CONVENTIONAL_COMMIT_REGEX = /^(\w+)(?:\(([^)]+)\))?(!)?: (.+)(?:\n\n([\s\S]*))?/;
// Regular expression to extract breaking change notes
const BREAKING_CHANGE_REGEX = /BREAKING CHANGE: ([\s\S]+?)(?:\n\n|$)/;

/**
 * Extract changelog entries from Git commits (with commit hashes for tracking)
 */
export interface CommitWithHash {
  hash: string;
  entry: ChangelogEntry;
}

export function extractChangelogEntriesWithHash(projectDir: string, revisionRange: string): CommitWithHash[] {
  try {
    const args = ['log', revisionRange, '--pretty=format:%H|||%B---COMMIT_DELIMITER---', '--no-merges', '--', '.'];
    const output = execSync('git', args, { cwd: projectDir, encoding: 'utf8' }).toString();

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

export function extractAllChangelogEntriesWithHash(projectDir: string, revisionRange: string): CommitWithHash[] {
  try {
    const args = ['log', revisionRange, '--pretty=format:%H|||%B---COMMIT_DELIMITER---', '--no-merges'];
    const output = execSync('git', args, { cwd: projectDir, encoding: 'utf8' }).toString();

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

/**
 * Extract changelog entries from Git commits
 * @param projectDir Directory to run git commands from
 * @param revisionRange Git revision range (e.g., "v1.0.0..v1.1.0" or tag name)
 * @returns Array of changelog entries
 */
export function extractChangelogEntriesFromCommits(projectDir: string, revisionRange: string): ChangelogEntry[] {
  return extractCommitsFromGitLog(projectDir, revisionRange, true);
}

/**
 * Extract ALL changelog entries from Git commits (including repo-level commits that don't affect any package)
 * @param projectDir Directory to run git commands from
 * @param revisionRange Git revision range (e.g., "v1.0.0..v1.1.0" or tag name)
 * @returns Array of changelog entries (including global commits not tied to any package)
 */
export function extractAllChangelogEntries(projectDir: string, revisionRange: string): ChangelogEntry[] {
  return extractCommitsFromGitLog(projectDir, revisionRange, false);
}

function extractCommitsFromGitLog(projectDir: string, revisionRange: string, filterToPath: boolean): ChangelogEntry[] {
  try {
    const args = ['log', revisionRange, '--pretty=format:%B---COMMIT_DELIMITER---', '--no-merges'];
    if (filterToPath) {
      args.push('--', '.');
    }
    const output = execSync('git', args, { cwd: projectDir, encoding: 'utf8' }).toString();

    // Split by commit delimiter and remove empty commits
    const commits = output.split('---COMMIT_DELIMITER---').filter((commit) => commit.trim() !== '');

    // Parse each commit and convert to changelog entries
    return commits
      .map((commit) => parseCommitMessage(commit))
      .filter((entry): entry is ChangelogEntry => entry !== null);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Provide more helpful error messages for common git issues
    if (errorMessage.includes('ambiguous argument') && errorMessage.includes('unknown revision')) {
      // This is likely a tag that doesn't exist
      const tagName = revisionRange.split('..')[0] || revisionRange;

      // Check if it might be a package-specific tag format issue
      if (tagName.startsWith('v') && !tagName.includes('@')) {
        log(
          `Error: Tag "${tagName}" not found. If you're using package-specific tags (like "package-name@v1.0.0"), you may need to configure "tagTemplate" in your version.config.json to use: \${packageName}@\${prefix}\${version}`,
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

/**
 * Parse a commit message into a changelog entry
 */
function parseCommitMessage(message: string): ChangelogEntry | null {
  // Trim whitespace from the message to handle leading/trailing newlines
  const trimmedMessage = message.trim();

  // Try to parse as conventional commit
  const match = trimmedMessage.match(CONVENTIONAL_COMMIT_REGEX);

  if (match) {
    const [, type, scope, breakingMark, subject, body = ''] = match;

    // Detect breaking changes from the ! marker or BREAKING CHANGE: in body
    const breakingFromMark = breakingMark === '!';
    const breakingChangeMatch = body.match(BREAKING_CHANGE_REGEX);
    const hasBreakingChange = breakingFromMark || breakingChangeMatch !== null;

    // Map conventional commit type to changelog type
    const changelogType = mapCommitTypeToChangelogType(type);

    // Skip certain commit types that usually aren't relevant to the changelog
    if (!changelogType) {
      return null;
    }

    // Extract issue IDs from footer (assuming format like "Fixes #123")
    const issueIds = extractIssueIds(body);

    // Format description, adding BREAKING prefix if needed
    let description = subject;
    if (hasBreakingChange) {
      description = `**BREAKING** ${description}`;
    }

    return {
      type: changelogType,
      description,
      scope: scope || undefined,
      issueIds: issueIds.length > 0 ? issueIds : undefined,
      originalType: type, // Store original type for custom formatting
    };
  }

  // Non-conventional commit - try to extract basic information
  // Only include if it seems meaningful (not just a merge or version bump)
  if (!trimmedMessage.startsWith('Merge') && !trimmedMessage.match(/^v?\d+\.\d+\.\d+/)) {
    const firstLine = trimmedMessage.split('\n')[0].trim();
    return {
      type: 'changed',
      description: firstLine,
    };
  }

  return null;
}

/**
 * Map conventional commit type to changelog entry type
 */
function mapCommitTypeToChangelogType(type: string): ChangelogEntry['type'] | null {
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
      // Special case - depend on commit message
      return 'changed';
    case 'test':
      // Usually test changes are not in changelog
      return null;
    default:
      // For unknown types, put in 'changed'
      return 'changed';
  }
}

/**
 * Extract issue IDs from commit message body
 */
function extractIssueIds(body: string): string[] {
  const issueRegex = /(?:fix|fixes|close|closes|resolve|resolves)\s+#(\d+)/gi;
  const issueIds: string[] = [];

  // Rewrite to avoid assignment in expression
  let match: RegExpExecArray | null = issueRegex.exec(body);
  while (match !== null) {
    issueIds.push(`#${match[1]}`);
    match = issueRegex.exec(body);
  }

  return issueIds;
}
