#!/usr/bin/env node

/**
 * This script is used to reset the test fixtures directory to its original state
 * after integration tests run, ensuring clean state for the next test run.
 */

import { execSync } from 'node:child_process';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Cross-platform delay function
 */
const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// Define the fixtures directory
const fixturesDir = join(process.cwd(), 'test/fixtures');

// Check if running as post-test hook or directly
const isPostTestHook = process.env.npm_lifecycle_event?.startsWith('posttest');
if (!isPostTestHook) {
  console.warn('⚠️  WARNING: Running cleanup script directly, not as a post-test hook.');
  console.warn('   This will reset ALL changes to test fixtures, which may not be what you want.');
  console.warn('   Press Ctrl+C to cancel or wait 3 seconds to continue...');

  // Wait 3 seconds to give user time to cancel - cross-platform approach
  (async () => {
    try {
      await delay(3000); // 3 seconds
      // Continue with the cleanup process after delay
      runCleanup();
    } catch (_) {
      // If interrupted, exit
      process.exit(0);
    }
  })();
} else {
  // If running as a post-test hook, proceed immediately
  runCleanup();
}

/**
 * Main cleanup function
 */
function runCleanup(): void {
  if (!existsSync(fixturesDir)) {
    console.error('Fixtures directory not found at', fixturesDir);
    process.exit(1);
  }

  try {
    console.log('Resetting test fixtures to match git repository...');

    // Check if there are any changes in fixtures to avoid unnecessary git operations
    const changes: string = execSync('git status --porcelain=v1 test/fixtures', {
      encoding: 'utf8',
    });

    if (!changes.trim()) {
      console.log('No changes detected in fixtures directory, nothing to reset.');
    } else {
      // Discard all changes in the fixtures directory
      execSync('git checkout -- test/fixtures', { stdio: 'inherit' });

      // Clean any untracked files in fixtures directory
      execSync('git clean -fd test/fixtures', { stdio: 'inherit' });
    }

    // Remove .git directories from fixtures to prevent Git-related errors in tests
    console.log('Removing .git directories from test fixtures...');
    removeGitDirectories(fixturesDir);

    console.log('✅ Successfully reset test fixtures to original state.');
  } catch (error) {
    console.error('❌ Error resetting test fixtures:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

/**
 * Recursively remove .git directories from a directory
 */
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
          // Recurse into other directories
          removeGitDirectories(entryPath);
        }
      }
    }
  } catch (error) {
    console.warn(`Warning: Could not process directory ${dir}:`, error);
  }
}
