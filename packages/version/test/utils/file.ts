import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Map to store original fixture content
const originalFixtures = new Map<string, string>();

/**
 * Recursively find all config files (package.json and version.config.json) in the given directory
 */
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
      item.name === 'version.config.json' ||
      item.name === 'pnpm-workspace.yaml'
    ) {
      files.push(itemPath);
    }
  }

  return files;
}

/**
 * Save the original state of all config files in fixtures directory
 */
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

/**
 * Remove all .git directories from fixtures
 */
export function cleanupGitDirectories(directory: string): void {
  if (!existsSync(directory)) {
    return;
  }

  const gitDir = join(directory, '.git');
  if (existsSync(gitDir)) {
    rmSync(gitDir, { recursive: true, force: true });
  }

  // Check subdirectories
  const items = readdirSync(directory, { withFileTypes: true });
  for (const item of items) {
    if (item.isDirectory()) {
      cleanupGitDirectories(join(directory, item.name));
    }
  }
}

/**
 * Restore all package.json files to their original state
 */
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

  // Clean up .git directories if a fixtures directory was provided
  if (fixturesDir && existsSync(fixturesDir)) {
    cleanupGitDirectories(fixturesDir);
  }
}
