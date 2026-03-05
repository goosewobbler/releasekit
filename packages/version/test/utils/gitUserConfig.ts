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
    // Properly escape shell special characters: escape backslashes first, then quotes
    // This prevents injection attacks and ensures special characters are handled correctly
    const escapedValue = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    execSync(`git config --local ${key} "${escapedValue}"`, { cwd });
  } else {
    // Unset if value is undefined
    execSync(`git config --local --unset ${key}`, { cwd });
  }
}
