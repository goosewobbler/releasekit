#!/usr/bin/env tsx
/**
 * Script to test each published releasekit package in isolation.
 *
 * For each package it:
 * 1. Packs all packages as tarballs (via pnpm pack)
 * 2. Creates an isolated temp directory with strict pnpm settings
 * 3. Installs only that package (with sibling overrides for internal deps)
 * 4. Runs smoke tests (ESM import + CLI --help)
 * 5. For @releasekit/release: runs a full dry-run in a temp git repo
 *
 * Usage:
 *   pnpm tsx scripts/test-packages.ts [--package=<name>] [--skip-build]
 *
 * Examples:
 *   pnpm tsx scripts/test-packages.ts                    # test all packages
 *   pnpm tsx scripts/test-packages.ts --package=version  # test only @releasekit/version
 *   pnpm tsx scripts/test-packages.ts --skip-build       # reuse existing tarballs
 */

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = normalize(join(__dirname, '..'));

// Packages that get published to npm
const PUBLISHED_PACKAGES = ['version', 'notes', 'publish', 'release'] as const;

const BIN_NAMES: Record<PackageName, string> = {
  version: 'releasekit-version',
  notes: 'releasekit-notes',
  publish: 'releasekit-publish',
  release: 'releasekit',
};

type PackageName = (typeof PUBLISHED_PACKAGES)[number];

function log(message: string): void {
  console.log(`🔧 ${message}`);
}

function execCommand(command: string, cwd: string, description: string): string {
  log(`${description}...`);
  try {
    const result = execSync(command, {
      cwd: normalize(cwd),
      stdio: 'pipe',
      encoding: 'utf-8',
      shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
    });
    log(`✅ ${description} completed`);
    return result;
  } catch (error) {
    console.error(`❌ ${description} failed:`);
    if (error instanceof Error) {
      console.error(error.message);
      if ('stderr' in error && error.stderr) {
        console.error(String(error.stderr));
      }
    }
    throw error;
  }
}

function execCommandInherit(command: string, cwd: string, description: string): void {
  log(`${description}...`);
  try {
    execSync(command, {
      cwd: normalize(cwd),
      stdio: 'inherit',
      encoding: 'utf-8',
      shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
    });
    log(`✅ ${description} completed`);
  } catch (error) {
    console.error(`❌ ${description} failed:`);
    if (error instanceof Error) {
      console.error(error.message);
    }
    throw error;
  }
}

function findTarball(dir: string, prefix: string): string {
  const files = readdirSync(dir);
  const tgzFile = files.find((f) => f.startsWith(prefix) && f.endsWith('.tgz'));
  if (!tgzFile) {
    throw new Error(`Could not find ${prefix}*.tgz in ${dir}`);
  }
  return normalize(join(dir, tgzFile));
}

function collectTarballs(): Record<PackageName, string> {
  const tarballs: Partial<Record<PackageName, string>> = {};

  for (const pkg of PUBLISHED_PACKAGES) {
    const pkgDir = join(rootDir, 'packages', pkg);
    tarballs[pkg] = findTarball(pkgDir, `releasekit-${pkg}-`);
  }

  log('📦 Tarballs:');
  for (const [pkg, tgzPath] of Object.entries(tarballs)) {
    log(`   ${pkg}: ${tgzPath}`);
  }

  return tarballs as Record<PackageName, string>;
}

function buildAndPack(): Record<PackageName, string> {
  log('Building and packing all packages...');

  execCommandInherit('pnpm build', rootDir, 'Building packages');

  for (const pkg of PUBLISHED_PACKAGES) {
    const pkgDir = join(rootDir, 'packages', pkg);
    if (!existsSync(pkgDir)) {
      throw new Error(`Package directory not found: ${pkgDir}`);
    }
    execCommandInherit('pnpm pack', pkgDir, `Packing @releasekit/${pkg}`);
  }

  return collectTarballs();
}

function findExistingTarballs(): Record<PackageName, string> {
  log('Finding existing tarballs...');
  return collectTarballs();
}

function createIsolatedDir(label: string): string {
  return mkdtempSync(join(tmpdir(), `releasekit-pkg-test-${label}-`));
}

function createPackageJson(dir: string, pkg: string, tarballs: Record<PackageName, string>): void {
  // Only override published sibling packages to use local tarballs.
  // Internal packages (core, config) must be bundled into each published
  // package — if they leak as dependencies the install will fail, which is
  // exactly what we want this test to catch.
  const overrides: Record<string, string> = {};
  const deps: Record<string, string> = {};

  for (const name of PUBLISHED_PACKAGES) {
    overrides[`@releasekit/${name}`] = `file:${tarballs[name]}`;
  }

  deps[`@releasekit/${pkg}`] = `file:${tarballs[pkg as PackageName]}`;

  const packageJson = {
    name: `@releasekit/test-${pkg}`,
    version: '0.0.0',
    private: true,
    type: 'module',
    dependencies: deps,
    pnpm: { overrides },
  };

  writeFileSync(join(dir, 'package.json'), JSON.stringify(packageJson, null, 2));

  // Disable hoisting so missing dependencies are not masked by sibling installs.
  // We use public-hoist-pattern to allow conventional-changelog presets to be
  // found by the preset loader (which dynamically imports them across packages).
  writeFileSync(
    join(dir, '.npmrc'),
    'hoist=false\npublic-hoist-pattern[]=conventional-changelog-*\npublic-hoist-pattern[]=conventional-commits-*\n',
  );
}

function testImport(dir: string, pkg: string): void {
  execCommand(
    `node -e "import('@releasekit/${pkg}').then(() => console.log('import ok'))"`,
    dir,
    `Testing import of @releasekit/${pkg}`,
  );
}

function testCli(dir: string, binName: string): void {
  execCommand(`pnpm exec ${binName} --help`, dir, `Testing ${binName} --help`);
}

function testReleaseDryRun(dir: string): void {
  // Create a temp git repo with conventional commits
  const repoDir = join(dir, 'test-repo');
  mkdirSync(repoDir, { recursive: true });

  execCommand('git init', repoDir, 'Initializing git repo');
  execCommand('git config user.email "test@test.com"', repoDir, 'Configuring git email');
  execCommand('git config user.name "Test User"', repoDir, 'Configuring git name');

  // Create a package.json and config
  writeFileSync(
    join(repoDir, 'package.json'),
    JSON.stringify({ name: 'test-pkg', version: '0.1.0', private: true }, null, 2),
  );
  writeFileSync(
    join(repoDir, 'releasekit.config.json'),
    JSON.stringify({
      version: { preset: 'angular', packages: ['./'] },
    }),
  );

  execCommand('git add -A && git commit -m "chore: initial commit"', repoDir, 'Creating initial commit');

  writeFileSync(join(repoDir, 'feature.txt'), 'change');
  execCommand('git add -A && git commit -m "feat: add feature"', repoDir, 'Creating feature commit');

  // Run from within the git repo directory to avoid --project-dir which
  // doesn't propagate to all internal git operations. Resolve the binary
  // via node so this works cross-platform (no symlinks needed).
  const releasekitBin = join(dir, 'node_modules', '@releasekit', 'release', 'dist', 'cli.js');
  const output = execCommand(
    `node "${releasekitBin}" release --dry-run --json`,
    repoDir,
    'Running releasekit release --dry-run --json',
  );

  // Validate JSON output
  try {
    const result = JSON.parse(output.trim());
    if (!result.versionOutput) {
      throw new Error('Missing versionOutput in release output');
    }
    if (!result.versionOutput.updates || result.versionOutput.updates.length === 0) {
      throw new Error('No version updates found');
    }
    log(`✅ Release dry-run produced valid output: ${result.versionOutput.updates.length} update(s)`);
  } catch (error) {
    console.error('Release output validation failed:');
    console.error(output);
    throw error;
  }
}

function testPackage(pkg: PackageName, tarballs: Record<PackageName, string>): void {
  log(`\n${'='.repeat(50)}`);
  log(`Testing @releasekit/${pkg}`);
  log('='.repeat(50));

  const tempDir = createIsolatedDir(pkg);

  try {
    createPackageJson(tempDir, pkg, tarballs);
    execCommandInherit('pnpm install', tempDir, `Installing @releasekit/${pkg}`);

    testImport(tempDir, pkg);
    testCli(tempDir, BIN_NAMES[pkg]);

    // For release package: test full dry-run
    if (pkg === 'release') {
      testReleaseDryRun(tempDir);
    }

    log(`✅ @releasekit/${pkg} passed all tests`);
  } finally {
    if (existsSync(tempDir)) {
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch {
        console.error(`⚠️  Failed to clean up: ${tempDir}`);
      }
    }
  }
}

function main(): void {
  const args = process.argv.slice(2);
  const skipBuild = args.includes('--skip-build');
  const packageArg = args.find((arg) => arg.startsWith('--package='))?.split('=')[1];

  const tarballs = skipBuild ? findExistingTarballs() : buildAndPack();

  const packagesToTest = packageArg ? PUBLISHED_PACKAGES.filter((p) => p === packageArg) : [...PUBLISHED_PACKAGES];

  if (packagesToTest.length === 0) {
    throw new Error(`Package '${packageArg}' not found. Available: ${PUBLISHED_PACKAGES.join(', ')}`);
  }

  const passed: string[] = [];
  const failed: string[] = [];

  for (const pkg of packagesToTest) {
    try {
      testPackage(pkg, tarballs);
      passed.push(pkg);
    } catch (error) {
      console.error(`❌ @releasekit/${pkg} failed:`);
      if (error instanceof Error) {
        console.error(error.message);
      }
      failed.push(pkg);
    }
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log('PACKAGE TEST SUMMARY');
  console.log('='.repeat(50));
  console.log(`Total: ${packagesToTest.length}`);
  console.log(`Passed: ${passed.length} (${passed.join(', ')})`);
  console.log(`Failed: ${failed.length}${failed.length > 0 ? ` (${failed.join(', ')})` : ''}`);

  if (failed.length > 0) {
    console.log('\n❌ Some package tests failed');
    process.exit(1);
  }

  console.log('\n🎉 All package tests passed!');
}

main();
