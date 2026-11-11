import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initGitRepo } from './git.js';
import { createPackageJson } from './package.js';
import { symlinkNodeModules } from './tempFixture.js';

export interface WorkspaceRepoOptions {
  /** Package name by directory under `packages/`. */
  packages: Record<string, string>;
  /** Of the root and every package. */
  version?: string;
  /** The config's `version` section. Omit it to write the config later with `writeVersionConfig`. */
  config?: Record<string, unknown>;
  workspaceGlobs?: string[];
  /** Where the workspace sits inside the git repository. */
  workspaceDir?: string;
  /** Created on the initial commit. */
  tags?: string[];
}

/** A pnpm workspace committed to a new temp git repository. Returns the repository root. */
export function createWorkspaceRepo(prefix: string, options: WorkspaceRepoOptions): string {
  const {
    packages,
    version = '0.1.0',
    config,
    workspaceGlobs = ['packages/*'],
    workspaceDir = '.',
    tags = [],
  } = options;
  const repo = mkdtempSync(join(tmpdir(), prefix));
  const workspace = join(repo, workspaceDir);
  mkdirSync(workspace, { recursive: true });
  // No workspaces field: @manypkg finds packages via pnpm-workspace.yaml, which needs no node_modules install.
  writeFileSync(join(workspace, 'package.json'), JSON.stringify({ name: 'monorepo', version, private: true }));
  writeFileSync(
    join(workspace, 'pnpm-workspace.yaml'),
    `packages:\n${workspaceGlobs.map((glob) => `  - "${glob}"\n`).join('')}`,
  );
  for (const [dir, name] of Object.entries(packages)) {
    mkdirSync(join(workspace, 'packages', dir), { recursive: true });
    createPackageJson(join(workspace, 'packages', dir), name, version);
  }
  if (config) {
    writeVersionConfig(workspace, config);
  }
  symlinkNodeModules(workspace);
  initGitRepo(repo);
  for (const tag of tags) {
    execSync(`git tag ${tag}`, { cwd: repo });
  }
  return repo;
}

export function writeVersionConfig(dir: string, versionConfig: Record<string, unknown>): void {
  writeFileSync(join(dir, 'releasekit.config.json'), JSON.stringify({ version: versionConfig }));
}
