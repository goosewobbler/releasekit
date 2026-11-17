import { execFileSync } from 'node:child_process';
import { readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function initGitRepo(dir: string): void {
  execFileSync('git', ['init'], { cwd: dir });
  console.log('[DEBUG] Ran git init in', dir);
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: dir });
  console.log('[DEBUG] Files before git add:', readdirSync(dir));
  execFileSync('git', ['add', '.'], { cwd: dir });
  console.log('[DEBUG] Files before git commit:', readdirSync(dir));

  try {
    const status = execFileSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf8' });
    if (status.trim() === '') {
      console.log('[DEBUG] No changes to commit in', dir);
      return;
    }
  } catch (error) {
    console.log('[DEBUG] Error checking git status:', error);
  }

  execFileSync('git', ['commit', '-m', 'Initial commit'], { cwd: dir });

  // Allow operations in nested git directories
  execFileSync('git', ['config', '--local', '--add', 'safe.directory', '*'], { cwd: dir });

  writeFileSync(join(dir, '.gitignore'), 'node_modules\n');
}

export function createConventionalCommit(
  dir: string,
  type: string,
  message: string,
  scope?: string,
  breaking = false,
  files: string[] = ['.'],
): void {
  if (files.length === 1 && files[0] === '.') {
    const changeFile = join(dir, 'change.txt');
    writeFileSync(changeFile, `Change: ${Date.now()}`);
    execFileSync('git', ['add', changeFile], { cwd: dir });
  } else {
    for (const file of files) {
      execFileSync('git', ['add', file], { cwd: dir });
    }
  }

  const header = `${type}${scope ? `(${scope})` : ''}${breaking ? '!' : ''}: ${message}`;

  try {
    execFileSync('git', ['commit', '-m', header], { cwd: dir });
  } catch {
    // Hooks such as lint-staged can fail the commit.
    execFileSync('git', ['commit', '--no-verify', '-m', header], { cwd: dir });
  }
}

export function safeGitCommit(cwd: string, message: string) {
  try {
    const status = execFileSync('git', ['status', '--porcelain'], { cwd }).toString();
    if (status.trim()) {
      execFileSync('git', ['commit', '-m', message], { cwd });
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
