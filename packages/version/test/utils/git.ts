import { execSync } from 'node:child_process';
import { readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Initialize a git repository in the given directory
 */
export function initGitRepo(dir: string): void {
  // Always initialize a git repo first
  execSync('git init', { cwd: dir });
  console.log('[DEBUG] Ran git init in', dir);
  execSync('git config user.email "test@example.com"', { cwd: dir });
  execSync('git config user.name "Test User"', { cwd: dir });
  // Debug: show files before git add
  console.log('[DEBUG] Files before git add:', readdirSync(dir));
  // Initial commit
  execSync('git add .', { cwd: dir });
  // Debug: show files before git commit
  console.log('[DEBUG] Files before git commit:', readdirSync(dir));

  // Check if there are any files to commit
  try {
    const status = execSync('git status --porcelain', { cwd: dir, encoding: 'utf8' });
    if (status.trim() === '') {
      console.log('[DEBUG] No changes to commit in', dir);
      return; // Skip commit if no changes
    }
  } catch (error) {
    console.log('[DEBUG] Error checking git status:', error);
  }

  execSync('git commit -m "Initial commit"', { cwd: dir });

  // Allow operations in nested git directories
  execSync('git config --local --add safe.directory "*"', { cwd: dir });

  // Create .gitignore
  writeFileSync(join(dir, '.gitignore'), 'node_modules\n');
}

/**
 * Create a conventional commit in the given repository
 */
export function createConventionalCommit(
  dir: string,
  type: string,
  message: string,
  scope?: string,
  breaking = false,
  files: string[] = ['.'],
): void {
  // Create or modify some files if none specified
  if (files.length === 1 && files[0] === '.') {
    const changeFile = join(dir, 'change.txt');
    writeFileSync(changeFile, `Change: ${Date.now()}`);
    execSync(`git add ${changeFile}`, { cwd: dir });
  } else {
    for (const file of files) {
      execSync(`git add ${file}`, { cwd: dir });
    }
  }

  const scopeStr = scope ? `(${scope})` : '';
  const breakingStr = breaking ? '!' : '';

  try {
    execSync(
      `git commit -m "${type}${scopeStr}${breakingStr}: ${message}${breaking ? '\n\nBREAKING CHANGE: This is a breaking change' : ''}"`,
      { cwd: dir },
    );
  } catch {
    // If the commit fails (e.g., due to lint-staged), try with --no-verify
    execSync(
      `git commit --no-verify -m "${type}${scopeStr}${breakingStr}: ${message}${breaking ? '\n\nBREAKING CHANGE: This is a breaking change' : ''}"`,
      { cwd: dir },
    );
  }
}

export function safeGitCommit(cwd: string, message: string) {
  try {
    const status = execSync('git status --porcelain', { cwd }).toString();
    if (status.trim()) {
      execSync(`git commit -m "${message}"`, { cwd });
    } else {
      console.log(`[DEBUG] No changes to commit in ${cwd}`);
    }
  } catch (err) {
    let errorMsg = '';
    if (err && typeof err === 'object') {
      if ('stderr' in err && err.stderr) {
        errorMsg = String((err as { stderr: string }).stderr);
      } else if ('message' in err) {
        errorMsg = String((err as Error).message);
      } else {
        errorMsg = String(err);
      }
    } else {
      errorMsg = String(err);
    }
    console.error(`[DEBUG] git commit failed in ${cwd}:`, errorMsg);
    throw err;
  }
}
