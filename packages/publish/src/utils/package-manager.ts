import * as fs from 'node:fs';
import * as path from 'node:path';

export type PackageManager = 'pnpm' | 'npm' | 'yarn';

export function detectPackageManager(cwd: string): PackageManager {
  if (fs.existsSync(path.join(cwd, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(cwd, 'yarn.lock'))) return 'yarn';
  return 'npm';
}

export function buildPublishCommand(
  pm: PackageManager,
  packageName: string,
  _packageDir: string,
  options: { access: string; tag: string; provenance: boolean; noGitChecks: boolean },
): { file: string; args: string[] } {
  const args: string[] = ['publish'];

  let file: string;
  if (pm === 'pnpm') {
    file = 'pnpm';
    args.push('--filter', packageName, '--access', options.access, '--tag', options.tag);
    if (options.noGitChecks) args.push('--no-git-checks');
  } else {
    file = 'npm';
    args.push('--access', options.access, '--tag', options.tag);
  }

  if (options.provenance) {
    args.push('--provenance');
  }

  return { file, args };
}

export function buildViewCommand(
  pm: PackageManager,
  packageName: string,
  version: string,
): { file: string; args: string[] } {
  const file = pm === 'pnpm' ? 'pnpm' : 'npm';
  return { file, args: ['view', `${packageName}@${version}`, 'version', '--json'] };
}
