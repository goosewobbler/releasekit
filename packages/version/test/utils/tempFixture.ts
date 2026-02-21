import { cpSync, existsSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * Copy a fixture directory to a new temp directory. Returns the temp dir path.
 */
export function copyFixtureToTemp(fixturePath: string): string {
  const tempDir = mkdtempSync(join(tmpdir(), 'pv-test-'));
  cpSync(resolve(fixturePath), tempDir, { recursive: true });
  return tempDir;
}

/**
 * Recursively delete a temp directory.
 */
export function cleanupTempDir(tempDir: string) {
  rmSync(tempDir, { recursive: true, force: true });
}

/**
 * Symlink the root node_modules into the temp directory.
 * This ensures all dependencies are available to the CLI when run from the temp dir.
 */
export function symlinkNodeModules(tempDir: string) {
  const rootNodeModules = resolve(__dirname, '../../node_modules');
  const target = join(tempDir, 'node_modules');
  // Only create the symlink if it doesn't already exist
  if (!existsSync(target)) {
    symlinkSync(rootNodeModules, target, 'dir');
  }
}
