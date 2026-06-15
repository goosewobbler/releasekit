import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_BRANCH = 'master';

export function createBareRemote(remotePath) {
  if (fs.existsSync(remotePath)) {
    fs.rmSync(remotePath, { recursive: true });
  }
  fs.mkdirSync(remotePath, { recursive: true });
  execSync('git init --bare', { cwd: remotePath, stdio: 'pipe' });
  return remotePath;
}

export function initGitRepo(projectDir, remotePath) {
  execSync('git init', { cwd: projectDir, stdio: 'pipe' });
  execSync('git config user.name "Test User"', { cwd: projectDir, stdio: 'pipe' });
  execSync('git config user.email "test@example.com"', { cwd: projectDir, stdio: 'pipe' });

  execSync(`git symbolic-ref HEAD refs/heads/${DEFAULT_BRANCH}`, { cwd: projectDir, stdio: 'pipe' });

  if (remotePath) {
    execSync(`git remote add origin ${remotePath}`, { cwd: projectDir, stdio: 'pipe' });
  }

  execSync('git add .', { cwd: projectDir, stdio: 'pipe' });
  execSync('git commit -m "initial commit"', { cwd: projectDir, stdio: 'pipe' });

  if (remotePath) {
    execSync(`git push -u origin ${DEFAULT_BRANCH}`, { cwd: projectDir, stdio: 'pipe' });
  }
}

export function addConventionalCommit(projectDir, message) {
  const randomFile = path.join(projectDir, `.commit-${Date.now()}.tmp`);
  fs.writeFileSync(randomFile, message);
  execSync('git add .', { cwd: projectDir, stdio: 'pipe' });
  execSync(`git commit -m "${message}"`, { cwd: projectDir, stdio: 'pipe' });
  fs.unlinkSync(randomFile);
}

let commitSeq = 0;

/**
 * Commit a change inside a specific subdirectory, optionally at a fixed date. Used by the backfill
 * harness to build per-package history (path-scoped) with deterministic tag dates. `date` is applied
 * to both author and committer so `git log --format=%cd` (what backfill reads) is reproducible.
 */
export function addCommitInDir(projectDir, message, relDir, date) {
  const dir = path.join(projectDir, relDir);
  fs.mkdirSync(dir, { recursive: true });
  commitSeq += 1;
  fs.writeFileSync(path.join(dir, `change-${commitSeq}.txt`), message);
  execSync('git add .', { cwd: projectDir, stdio: 'pipe' });
  const env = { ...process.env };
  if (date) {
    env.GIT_AUTHOR_DATE = date;
    env.GIT_COMMITTER_DATE = date;
  }
  execSync(`git commit -m ${JSON.stringify(message)}`, { cwd: projectDir, stdio: 'pipe', env });
}

/** Create a lightweight tag at the current HEAD. */
export function addTag(projectDir, tag) {
  execSync(`git tag ${tag}`, { cwd: projectDir, stdio: 'pipe' });
}

export function verifyTags(projectDir, expectedTags) {
  const tags = execSync('git tag', { cwd: projectDir, encoding: 'utf-8' }).trim().split('\n').filter(Boolean);

  for (const expected of expectedTags) {
    if (!tags.includes(expected)) {
      throw new Error(`Expected tag "${expected}" not found. Found tags: ${tags.join(', ')}`);
    }
  }
  return true;
}

export function verifyVersionCommit(projectDir) {
  const log = execSync('git log --oneline -10', { cwd: projectDir, encoding: 'utf-8' });
  if (!log.includes('chore(release)')) {
    throw new Error(`Version commit not found. Recent commits:\n${log}`);
  }
  return true;
}

export function getLastVersion(projectDir) {
  const tag = execSync('git describe --tags --abbrev=0', { cwd: projectDir, encoding: 'utf-8' }).trim();
  return tag;
}

export function pushToRemote(projectDir) {
  execSync(`git push origin ${DEFAULT_BRANCH} --tags`, { cwd: projectDir, stdio: 'pipe' });
}

export function getRemoteRefs(remotePath) {
  try {
    const branches = execSync('git branch -a', { cwd: remotePath, encoding: 'utf-8' }).trim();
    const tags = execSync('git tag', { cwd: remotePath, encoding: 'utf-8' }).trim();
    return { branches, tags };
  } catch {
    return { branches: '', tags: '' };
  }
}
