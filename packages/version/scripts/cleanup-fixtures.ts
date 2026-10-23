#!/usr/bin/env node

/** Resets test/fixtures to its committed state after integration tests run. */

import { execSync } from 'node:child_process';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const fixturesDir = join(process.cwd(), 'test/fixtures');

const isPostTestHook = process.env.npm_lifecycle_event?.startsWith('posttest');
if (!isPostTestHook) {
  console.warn('⚠️  WARNING: Running cleanup script directly, not as a post-test hook.');
  console.warn('   This will reset ALL changes to test fixtures, which may not be what you want.');
  console.warn('   Press Ctrl+C to cancel or wait 3 seconds to continue...');

  (async () => {
    try {
      await delay(3000);
      runCleanup();
    } catch (_) {
      process.exit(0);
    }
  })();
} else {
  runCleanup();
}

function runCleanup(): void {
  if (!existsSync(fixturesDir)) {
    console.error('Fixtures directory not found at', fixturesDir);
    process.exit(1);
  }

  try {
    console.log('Resetting test fixtures to match git repository...');

    const changes: string = execSync('git status --porcelain=v1 test/fixtures', {
      encoding: 'utf8',
    });

    if (!changes.trim()) {
      console.log('No changes detected in fixtures directory, nothing to reset.');
    } else {
      execSync('git checkout -- test/fixtures', { stdio: 'inherit' });

      execSync('git clean -fd test/fixtures', { stdio: 'inherit' });
    }

    console.log('Removing .git directories from test fixtures...');
    removeGitDirectories(fixturesDir);

    console.log('✅ Successfully reset test fixtures to original state.');
  } catch (error) {
    console.error('❌ Error resetting test fixtures:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

function removeGitDirectories(dir: string): void {
  try {
    const entries = readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const entryPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        if (entry.name === '.git') {
          console.log(`Removing ${entryPath}`);
          rmSync(entryPath, { recursive: true, force: true });
        } else {
          removeGitDirectories(entryPath);
        }
      }
    }
  } catch (error) {
    console.warn(`Warning: Could not process directory ${dir}:`, error);
  }
}
