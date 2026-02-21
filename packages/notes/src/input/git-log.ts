import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ChangelogEntry, ChangelogInput, PackageChangelog } from '../core/types.js';
import { InputParseError } from '../errors/index.js';

interface GitLogCommit {
  hash: string;
  message: string;
  author: string;
  date: string;
}

function parseGitLog(fromRef?: string, toRef = 'HEAD'): GitLogCommit[] {
  const range = fromRef ? `${fromRef}..${toRef}` : toRef;

  try {
    const output = execSync(`git log ${range} --pretty=format:"%H|||%s|||%an|||%ad" --date=short`, {
      encoding: 'utf-8',
    });

    if (!output.trim()) {
      return [];
    }

    return output
      .trim()
      .split('\n')
      .map((line) => {
        const [hash, message, author, date] = line.split('|||');
        return { hash: hash ?? '', message: message ?? '', author: author ?? '', date: date ?? '' };
      });
  } catch (error) {
    throw new InputParseError(`Failed to parse git log: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function parseConventionalCommit(message: string): ChangelogEntry | null {
  const conventionalPattern =
    /^(feat|fix|docs|style|refactor|test|chore|perf|ci|build|revert)(\([^)]+\))?(!)?:\s*(.+)$/i;
  const match = message.match(conventionalPattern);

  if (!match) {
    return null;
  }

  const [, type, scope, breaking, description] = match;

  const typeMap: Record<string, ChangelogEntry['type']> = {
    feat: 'added',
    fix: 'fixed',
    docs: 'changed',
    style: 'changed',
    refactor: 'changed',
    test: 'changed',
    chore: 'changed',
    perf: 'changed',
    ci: 'changed',
    build: 'changed',
    revert: 'removed',
  };

  const issuePattern = /#(\d+)/g;
  const issueIds: string[] = [];
  let issueMatch: RegExpExecArray | null;
  issueMatch = issuePattern.exec(message);
  while (issueMatch !== null) {
    issueIds.push(`#${issueMatch[1]}`);
    issueMatch = issuePattern.exec(message);
  }

  return {
    type: typeMap[type?.toLowerCase() ?? ''] ?? 'changed',
    description: description ?? message,
    scope: scope?.slice(1, -1),
    breaking: breaking === '!' || message.includes('BREAKING CHANGE'),
    issueIds: issueIds.length > 0 ? issueIds : undefined,
    originalType: type,
  };
}

function getGitRemoteUrl(): string | null {
  try {
    const output = execSync('git remote get-url origin', { encoding: 'utf-8' });
    return output.trim();
  } catch {
    return null;
  }
}

function getCurrentVersion(): string {
  try {
    const output = execSync('git describe --tags --abbrev=0', { encoding: 'utf-8' });
    return output.trim().replace(/^v/, '');
  } catch {
    return '0.0.0';
  }
}

function getPackageName(): string {
  try {
    const packageJsonPath = path.join(process.cwd(), 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      const content = fs.readFileSync(packageJsonPath, 'utf-8');
      const pkg = JSON.parse(content);
      return pkg.name ?? 'package';
    }
  } catch {
    // ignore
  }
  return 'package';
}

export function parseGitLogInput(fromRef?: string, toRef = 'HEAD'): ChangelogInput {
  const commits = parseGitLog(fromRef, toRef);

  const entries: ChangelogEntry[] = [];

  for (const commit of commits) {
    const parsed = parseConventionalCommit(commit.message);

    if (parsed) {
      entries.push(parsed);
    } else if (commit.message && !commit.message.startsWith('Merge') && !commit.message.startsWith('Revert')) {
      entries.push({
        type: 'changed',
        description: commit.message,
      });
    }
  }

  const version = getCurrentVersion();
  const packageName = getPackageName();
  const repoUrl = getGitRemoteUrl();

  const pkg: PackageChangelog = {
    packageName,
    version,
    previousVersion: fromRef ? fromRef.replace(/^v/, '') : null,
    revisionRange: fromRef ? `${fromRef}..${toRef}` : toRef,
    repoUrl,
    date: new Date().toISOString().split('T')[0] ?? '',
    entries,
  };

  return {
    source: 'git-log',
    packages: [pkg],
    metadata: {
      repoUrl: repoUrl ?? undefined,
    },
  };
}
