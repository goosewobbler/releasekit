import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface CLIResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export async function runCLI(
  command: string,
  args: string[],
  cwd: string,
  options?: { stdin?: string; env?: Record<string, string> },
): Promise<CLIResult> {
  const fullCommand = `pnpm exec ${command} ${args.join(' ')}`;

  return new Promise((resolve) => {
    const child = spawn(fullCommand, [], {
      cwd,
      env: { ...process.env, ...options?.env },
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      resolve({
        exitCode: code ?? 1,
        stdout,
        stderr,
      });
    });

    child.on('error', (error) => {
      resolve({
        exitCode: 1,
        stdout,
        stderr: error.message,
      });
    });

    if (options?.stdin) {
      child.stdin?.write(options.stdin);
      child.stdin?.end();
    }
  });
}

export async function createGitRepo(): Promise<string> {
  const tempDir = mkdtempSync(join(tmpdir(), 'releasekit-e2e-'));

  await runCLI('git', ['init'], tempDir);
  await runCLI('git', ['config', 'user.email', '"test@test.com"'], tempDir);
  await runCLI('git', ['config', 'user.name', '"Test User"'], tempDir);

  return tempDir;
}

export async function gitCommit(repoDir: string, message: string): Promise<void> {
  const markerFile = join(repoDir, `.commit-${Date.now()}`);
  writeFileSync(markerFile, message);

  await runCLI('git', ['add', markerFile], repoDir);
  await runCLI('git', ['commit', '-m', `"${message}"`], repoDir);
}

export async function cleanupRepo(repoDir: string): Promise<void> {
  if (existsSync(repoDir)) {
    rmSync(repoDir, { recursive: true, force: true });
  }
}

export async function createPackageJson(repoDir: string, name: string, version: string): Promise<void> {
  const packageJson = { name, version, private: true };
  writeFileSync(join(repoDir, 'package.json'), JSON.stringify(packageJson, null, 2));
}

export async function createVersionConfig(repoDir: string, config: Record<string, unknown>): Promise<void> {
  writeFileSync(join(repoDir, 'version.config.json'), JSON.stringify(config, null, 2));
}

export async function createReleasekitConfig(repoDir: string, config: Record<string, unknown>): Promise<void> {
  writeFileSync(join(repoDir, 'releasekit.config.json'), JSON.stringify(config, null, 2));
}

export async function createPnpmWorkspace(repoDir: string, packages: string[]): Promise<void> {
  const content = `packages:\n${packages.map((p) => `  - '${p}'`).join('\n')}\n`;
  writeFileSync(join(repoDir, 'pnpm-workspace.yaml'), content);
}

export async function createMonorepoPackage(repoDir: string, packageName: string, version: string): Promise<string> {
  const pkgDir = join(repoDir, 'packages', packageName);
  mkdirSync(pkgDir, { recursive: true });

  const packageJson = { name: `@test/${packageName}`, version, private: true };
  writeFileSync(join(pkgDir, 'package.json'), JSON.stringify(packageJson, null, 2));

  return pkgDir;
}
