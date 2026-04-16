import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { addConventionalCommit, createBareRemote, initGitRepo } from './mock-git.mjs';

const TEST_PREFIX = 'releasekit-test';

export function createTestProject(_options = {}) {
  const timestamp = Date.now();
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), `${TEST_PREFIX}-${timestamp}`));

  console.log(`Creating test project at: ${projectDir}`);

  const remotePath = path.join(projectDir, 'test-remote.git');
  createBareRemote(remotePath);

  createMonorepoStructure(projectDir);
  initGitRepo(projectDir, remotePath);

  const commits = [
    'feat(pkg-a): add initial feature',
    'fix(pkg-b): fix a bug',
    'docs: update README',
    'feat(pkg-c): add new feature',
    'fix(pkg-a): fix another bug',
    'feat(pkg-b): add feature to pkg-b',
    'style: format code',
    'refactor(pkg-c): refactor code',
    'test(pkg-a): add tests',
    'chore: update dependencies',
  ];

  for (const msg of commits) {
    addConventionalCommit(projectDir, msg);
  }

  console.log(`Test project created with ${commits.length} commits`);

  return {
    projectDir,
    remotePath,
    packages: ['pkg-a', 'pkg-b', 'pkg-c'],
  };
}

function createMonorepoStructure(projectDir) {
  const rootPackageJson = {
    name: 'test-monorepo',
    version: '1.0.0',
    private: true,
    scripts: {
      test: 'echo "test"',
    },
  };

  fs.writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify(rootPackageJson, null, 2));

  fs.writeFileSync(path.join(projectDir, 'pnpm-workspace.yaml'), 'packages:\n  - "packages/*"\n');

  const packagesDir = path.join(projectDir, 'packages');
  fs.mkdirSync(packagesDir, { recursive: true });

  const packages = [
    {
      name: '@test/pkg-a',
      version: '1.0.0',
      description: 'Test package A',
    },
    {
      name: '@test/pkg-b',
      version: '1.0.0',
      description: 'Test package B',
    },
    {
      name: '@test/pkg-c',
      version: '1.0.0',
      description: 'Test package C',
    },
  ];

  for (const pkg of packages) {
    const pkgDir = path.join(packagesDir, pkg.name.replace('@test/', ''));
    fs.mkdirSync(pkgDir, { recursive: true });

    const pkgJson = {
      name: pkg.name,
      version: pkg.version,
      description: pkg.description,
      main: './dist/index.js',
      scripts: {
        build: 'echo "build"',
      },
    };

    fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify(pkgJson, null, 2));

    fs.mkdirSync(path.join(pkgDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(pkgDir, 'src', 'index.js'), 'export const hello = "world";\n');
  }

  const releasekitConfig = {
    packages: ['packages/*'],
    version: {
      preset: 'angular',
    },
  };

  fs.writeFileSync(path.join(projectDir, 'releasekit.config.json'), JSON.stringify(releasekitConfig, null, 2));

  installDependencies(projectDir);
}

function installDependencies(projectDir) {
  console.log('Installing dependencies...');
  try {
    execSync('pnpm install --frozen-lockfile', {
      cwd: projectDir,
      stdio: 'inherit',
      env: { ...process.env, PNPM_HOME: process.env.PNPM_HOME },
    });
  } catch {
    console.log('Frozen lockfile failed, trying regular install...');
    execSync('pnpm install', {
      cwd: projectDir,
      stdio: 'inherit',
      env: { ...process.env, PNPM_HOME: process.env.PNPM_HOME },
    });
  }
}

export function cleanupTestProject(projectDir) {
  if (fs.existsSync(projectDir)) {
    fs.rmSync(projectDir, { recursive: true });
    console.log(`Cleaned up: ${projectDir}`);
  }
}
