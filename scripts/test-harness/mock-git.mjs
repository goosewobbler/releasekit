import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

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

  const defaultBranch = 'master';
  execSync(`git symbolic-ref HEAD refs/heads/${defaultBranch}`, { cwd: projectDir, stdio: 'pipe' });

  if (remotePath) {
    execSync(`git remote add origin ${remotePath}`, { cwd: projectDir, stdio: 'pipe' });
  }

  execSync('git add .', { cwd: projectDir, stdio: 'pipe' });
  execSync('git commit -m "initial commit"', { cwd: projectDir, stdio: 'pipe' });

  if (remotePath) {
    execSync(`git push -u origin ${defaultBranch}`, { cwd: projectDir, stdio: 'pipe' });
  }
}

export function addConventionalCommit(projectDir, message) {
  const randomFile = path.join(projectDir, `.commit-${Date.now()}.tmp`);
  fs.writeFileSync(randomFile, message);
  execSync('git add .', { cwd: projectDir, stdio: 'pipe' });
  execSync(`git commit -m "${message}"`, { cwd: projectDir, stdio: 'pipe' });
  fs.unlinkSync(randomFile);
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
  execSync('git push origin main --tags', { cwd: projectDir, stdio: 'pipe' });
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
