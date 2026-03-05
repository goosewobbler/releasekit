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
    // Escape double quotes to prevent shell injection
    const escapedValue = value.replace(/"/g, '\\"');
    execSync(`git config --local ${key} "${escapedValue}"`, { cwd });
  } else {
    // Unset if value is undefined
    execSync(`git config --local --unset ${key}`, { cwd });
  }
}
