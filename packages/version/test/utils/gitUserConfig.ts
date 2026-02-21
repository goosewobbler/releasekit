import { execSync } from 'node:child_process';

export function getGitConfig(key: string, cwd?: string): string | undefined {
  try {
    return execSync(`git config --local --get ${key}`, { cwd, encoding: 'utf8' }).trim();
  } catch {
    return undefined;
  }
}

export function setGitConfig(key: string, value?: string, cwd?: string) {
  if (value) {
    execSync(`git config --local ${key} "${value.replace(/"/g, '"')}"`, { cwd });
  } else {
    // Unset if value is undefined
    execSync(`git config --local --unset ${key}`, { cwd });
  }
}
