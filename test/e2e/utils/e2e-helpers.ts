import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

export interface FileStructure {
  [path: string]: string;
}

export function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'releasekit-e2e-'));
}

export function cleanupTempDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

export function createFileStructure(baseDir: string, structure: FileStructure): void {
  for (const [relativePath, content] of Object.entries(structure)) {
    const fullPath = join(baseDir, relativePath);
    const dir = dirname(fullPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(fullPath, content);
  }
}

export function initGitRepo(dir: string): void {
  execSync('git init', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.name "Test User"', { cwd: dir, stdio: 'pipe' });
  execSync('git add .', { cwd: dir, stdio: 'pipe' });
  execSync('git commit -m "chore: initial commit"', { cwd: dir, stdio: 'pipe' });
}

export function createGitCommit(dir: string, message: string, files?: string[]): void {
  if (files && files.length > 0) {
    for (const file of files) {
      execSync(`git add "${file}"`, { cwd: dir, stdio: 'pipe' });
    }
  } else {
    execSync('git add .', { cwd: dir, stdio: 'pipe' });
  }
  execSync(`git commit -m "${message}"`, { cwd: dir, stdio: 'pipe' });
}

export function createConventionalCommit(
  dir: string,
  type: 'feat' | 'fix' | 'chore' | 'docs' | 'refactor',
  description: string,
  scope?: string,
  breaking?: boolean,
  files?: string[],
): void {
  const scopePart = scope ? `(${scope})` : '';
  const breakingPart = breaking ? '!' : '';
  const message = `${type}${scopePart}${breakingPart}: ${description}`;

  if (!files || files.length === 0) {
    const markerFile = join(dir, `.commit-marker-${Date.now()}`);
    writeFileSync(markerFile, message);
    createGitCommit(dir, message, [markerFile]);
  } else {
    createGitCommit(dir, message, files);
  }
}

export function getPackageVersion(dir: string, packageName?: string): string {
  const packageJsonPath = packageName ? findPackageJson(dir, packageName) : join(dir, 'package.json');

  if (!existsSync(packageJsonPath)) {
    throw new Error(`package.json not found at ${packageJsonPath}`);
  }

  const content = readFileSync(packageJsonPath, 'utf-8');
  const pkg = JSON.parse(content);
  return pkg.version;
}

function findPackageJson(dir: string, packageName: string): string {
  const possiblePaths = [
    join(dir, 'packages', packageName, 'package.json'),
    join(dir, 'packages', packageName.replace(/^@[^/]+\//, ''), 'package.json'),
    join(dir, packageName, 'package.json'),
  ];

  for (const p of possiblePaths) {
    if (existsSync(p)) {
      return p;
    }
  }

  throw new Error(`Could not find package.json for ${packageName}`);
}

export function copyFixtureToTemp(fixtureName: string): string {
  const fixturePath = resolve(__dirname, '../fixtures', fixtureName);
  const tempDir = createTempDir();
  cpSync(fixturePath, tempDir, { recursive: true });
  return tempDir;
}
