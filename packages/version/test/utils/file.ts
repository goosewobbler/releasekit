import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const originalFixtures = new Map<string, string>();

export function findConfigFiles(directory: string): string[] {
  const files: string[] = [];

  if (!existsSync(directory)) {
    return files;
  }

  const items = readdirSync(directory, { withFileTypes: true });

  for (const item of items) {
    const itemPath = join(directory, item.name);
    if (item.isDirectory()) {
      files.push(...findConfigFiles(itemPath));
    } else if (
      item.name === 'package.json' ||
      item.name === 'releasekit.config.json' ||
      item.name === 'pnpm-workspace.yaml'
    ) {
      files.push(itemPath);
    }
  }

  return files;
}

export function saveFixtureState(fixturesDir: string): void {
  const configFiles = findConfigFiles(fixturesDir);

  for (const filePath of configFiles) {
    try {
      const content = readFileSync(filePath, 'utf8');
      originalFixtures.set(filePath, content);
    } catch (error) {
      console.warn(`Could not save original state of ${filePath}:`, error);
    }
  }
}

export function cleanupGitDirectories(directory: string): void {
  if (!existsSync(directory)) {
    return;
  }

  const gitDir = join(directory, '.git');
  if (existsSync(gitDir)) {
    rmSync(gitDir, { recursive: true, force: true });
  }

  const items = readdirSync(directory, { withFileTypes: true });
  for (const item of items) {
    if (item.isDirectory()) {
      cleanupGitDirectories(join(directory, item.name));
    }
  }
}

export function restoreFixtureState(fixturesDir?: string): void {
  for (const [filePath, content] of originalFixtures) {
    try {
      if (existsSync(filePath)) {
        writeFileSync(filePath, content);
      }
    } catch (error) {
      console.warn(`Could not restore original state of ${filePath}:`, error);
    }
  }

  if (fixturesDir && existsSync(fixturesDir)) {
    cleanupGitDirectories(fixturesDir);
  }
}
