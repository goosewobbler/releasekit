import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { addCommitInDir, addConventionalCommit, addTag, createBareRemote, initGitRepo } from './mock-git.mjs';

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
    version: {
      preset: 'angular',
      packages: ['packages/*'],
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

/**
 * Build a fixture for the backfill scenario: a two-package monorepo with a shared global (sync) tag
 * series (`v1.0.0`, `v1.1.0`) whose commits are scoped to each package's directory and stamped with
 * fixed dates. No dependency install — backfill only reads git and writes notes files. The encoded
 * `expected` map drives the assertions in the harness.
 */
export function createBackfillTestProject() {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), `${TEST_PREFIX}-backfill-${Date.now()}`));
  console.log(`Creating backfill test project at: ${projectDir}`);

  const remotePath = path.join(projectDir, 'test-remote.git');
  createBareRemote(remotePath);

  fs.writeFileSync(
    path.join(projectDir, 'package.json'),
    JSON.stringify({ name: 'backfill-monorepo', version: '1.0.0', private: true }, null, 2),
  );
  fs.writeFileSync(path.join(projectDir, 'pnpm-workspace.yaml'), 'packages:\n  - "packages/*"\n');

  for (const slug of ['alpha', 'beta']) {
    const pkgDir = path.join(projectDir, 'packages', slug);
    fs.mkdirSync(path.join(pkgDir, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(pkgDir, 'package.json'),
      JSON.stringify(
        {
          name: `@test/${slug}`,
          version: '1.0.0',
          repository: { type: 'git', url: 'git+https://github.com/test/backfill.git' },
        },
        null,
        2,
      ),
    );
    fs.writeFileSync(path.join(pkgDir, 'src', 'index.js'), 'export const hello = "world";\n');
  }

  fs.writeFileSync(
    path.join(projectDir, 'releasekit.config.json'),
    JSON.stringify(
      {
        version: { versionPrefix: 'v', packages: ['packages/*'] },
        notes: { releaseNotes: { file: { dir: 'release-notes' } } },
      },
      null,
      2,
    ),
  );

  // initGitRepo stages everything and makes the initial (non-conventional) commit.
  initGitRepo(projectDir, remotePath);

  // v1.0.0 era — one scoped commit per package; the tag lands on the last commit (2023-01-11).
  addCommitInDir(projectDir, 'feat(alpha): alpha one', 'packages/alpha', '2023-01-10T00:00:00');
  addCommitInDir(projectDir, 'feat(beta): beta one', 'packages/beta', '2023-01-11T00:00:00');
  addTag(projectDir, 'v1.0.0');

  // v1.1.0 era — the tag lands on the last commit (2023-03-06).
  addCommitInDir(projectDir, 'fix(alpha): alpha two', 'packages/alpha', '2023-03-05T00:00:00');
  addCommitInDir(projectDir, 'feat(beta): beta two', 'packages/beta', '2023-03-06T00:00:00');
  addTag(projectDir, 'v1.1.0');

  console.log('Backfill test project created with tags v1.0.0, v1.1.0');

  return {
    projectDir,
    remotePath,
    // Global tags → both packages share each version's date (the tagged commit's date).
    expected: [
      { file: '@test/alpha/1.0.0.md', date: '2023-01-11', has: ['alpha one'], hasNot: ['beta one'] },
      { file: '@test/alpha/1.1.0.md', date: '2023-03-06', has: ['alpha two'], hasNot: ['beta two'] },
      { file: '@test/beta/1.0.0.md', date: '2023-01-11', has: ['beta one'], hasNot: ['alpha one'] },
      { file: '@test/beta/1.1.0.md', date: '2023-03-06', has: ['beta two'], hasNot: ['alpha two'] },
    ],
  };
}

export function cleanupTestProject(projectDir) {
  if (fs.existsSync(projectDir)) {
    fs.rmSync(projectDir, { recursive: true });
    console.log(`Cleaned up: ${projectDir}`);
  }
}

export function createMultiRegistryTestProject({ npmEnabled = true } = {}) {
  const timestamp = Date.now();
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), `${TEST_PREFIX}-multi-${timestamp}`));

  console.log(`Creating multi-registry test project at: ${projectDir}`);

  const remotePath = path.join(projectDir, 'test-remote.git');
  createBareRemote(remotePath);

  createMultiRegistryMonorepoStructure(projectDir, { npmEnabled });
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

  console.log(`Multi-registry test project created with ${commits.length} commits`);

  return {
    projectDir,
    remotePath,
    packages: ['pkg-a', 'pkg-b', 'pkg-c'],
  };
}

function createMultiRegistryMonorepoStructure(projectDir, { npmEnabled = true } = {}) {
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

  const pkgNames = ['pkg-a', 'pkg-b', 'pkg-c'];
  const members = pkgNames.map((n) => `    "packages/${n}"`).join(',\n');
  fs.writeFileSync(path.join(projectDir, 'Cargo.toml'), `[workspace]\nmembers = [\n${members}\n]\nresolver = "2"\n`);

  const packagesDir = path.join(projectDir, 'packages');
  fs.mkdirSync(packagesDir, { recursive: true });

  const packages = [
    { name: '@test/pkg-a', slug: 'pkg-a', version: '1.0.0', description: 'Test package A' },
    { name: '@test/pkg-b', slug: 'pkg-b', version: '1.0.0', description: 'Test package B' },
    { name: '@test/pkg-c', slug: 'pkg-c', version: '1.0.0', description: 'Test package C' },
  ];

  for (const pkg of packages) {
    const pkgDir = path.join(packagesDir, pkg.slug);
    fs.mkdirSync(pkgDir, { recursive: true });

    fs.writeFileSync(
      path.join(pkgDir, 'package.json'),
      JSON.stringify(
        {
          name: pkg.name,
          version: pkg.version,
          description: pkg.description,
          main: './dist/index.js',
          scripts: { build: 'echo "build"' },
        },
        null,
        2,
      ),
    );

    fs.writeFileSync(
      path.join(pkgDir, 'Cargo.toml'),
      `[package]\nname = "${pkg.slug}"\nversion = "${pkg.version}"\nedition = "2021"\n`,
    );

    fs.mkdirSync(path.join(pkgDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(pkgDir, 'src', 'index.js'), 'export const hello = "world";\n');
  }

  const releasekitConfig = {
    version: {
      preset: 'angular',
      packages: ['packages/*'],
      // Opt out of npm version handling to exercise the "detection enables, config opts out" path:
      // package.json manifests are left untouched while Cargo.toml is still versioned.
      ...(npmEnabled ? {} : { npm: { enabled: false } }),
    },
  };

  fs.writeFileSync(path.join(projectDir, 'releasekit.config.json'), JSON.stringify(releasekitConfig, null, 2));

  installDependencies(projectDir);
}
