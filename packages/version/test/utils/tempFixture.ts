import { cpSync, existsSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export function copyFixtureToTemp(fixturePath: string): string {
  const tempDir = mkdtempSync(join(tmpdir(), 'pv-test-'));
  cpSync(resolve(fixturePath), tempDir, { recursive: true });
  return tempDir;
}

export function cleanupTempDir(tempDir: string) {
  rmSync(tempDir, { recursive: true, force: true });
}

/** So the CLI can resolve its dependencies when run from the temp dir. */
export function symlinkNodeModules(tempDir: string) {
  const rootNodeModules = resolve(__dirname, '../../node_modules');
  const target = join(tempDir, 'node_modules');
  if (!existsSync(target)) {
    symlinkSync(rootNodeModules, target, 'dir');
  }
}
