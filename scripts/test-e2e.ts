#!/usr/bin/env tsx
/**
 * Script to run E2E tests in an isolated environment
 * Usage: pnpm tsx scripts/test-e2e.ts [--skip-build]
 *
 * This script:
 * 1. Packs releasekit packages as tarballs
 * 2. Creates an isolated temp directory
 * 3. Installs dependencies from tarballs
 * 4. Runs bash E2E tests
 * 5. Cleans up
 */

import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = normalize(join(__dirname, '..'));

interface TarballPaths {
  core: string;
  notes: string;
  version: string;
  config: string;
  publish: string;
  release: string;
}

function log(message: string): void {
  console.log(`🔧 ${message}`);
}

function execCommand(command: string, cwd: string, description: string): void {
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

async function buildAndPackPackages(): Promise<TarballPaths> {
  log('Building and packing packages...');

  execCommand('pnpm build', rootDir, 'Building packages');

  const packages = ['core', 'config', 'version', 'notes', 'publish', 'release'];
  const tarballs: Partial<TarballPaths> = {};

  for (const pkg of packages) {
    const pkgDir = join(rootDir, 'packages', pkg);
    if (!existsSync(pkgDir)) {
      throw new Error(`Package directory not found: ${pkgDir}`);
    }
    execCommand('pnpm pack', pkgDir, `Packing @releasekit/${pkg}`);
  }

  for (const pkg of packages) {
    const pkgDir = join(rootDir, 'packages', pkg);
    const prefix = `releasekit-${pkg}-`;
    tarballs[pkg as keyof TarballPaths] = findTarball(pkgDir, prefix);
  }

  log('📦 Packages packed:');
  for (const [pkg, path] of Object.entries(tarballs)) {
    log(`   ${pkg}: ${path}`);
  }

  return tarballs as TarballPaths;
}

function findExistingTarballs(): TarballPaths {
  log('Finding existing tarballs...');

  const packages = ['core', 'config', 'version', 'notes', 'publish', 'release'];
  const tarballs: Partial<TarballPaths> = {};

  for (const pkg of packages) {
    const pkgDir = join(rootDir, 'packages', pkg);
    const prefix = `releasekit-${pkg}-`;
    tarballs[pkg as keyof TarballPaths] = findTarball(pkgDir, prefix);
  }

  log('📦 Found tarballs:');
  for (const [pkg, path] of Object.entries(tarballs)) {
    log(`   ${pkg}: ${path}`);
  }

  return tarballs as TarballPaths;
}

function createIsolatedEnvironment(tarballs: TarballPaths): string {
  const testId = Date.now();
  const tempDir = normalize(join(tmpdir(), `releasekit-e2e-isolated-${testId}`));

  log(`Creating isolated test environment at ${tempDir}`);
  mkdirSync(tempDir, { recursive: true });

  // Copy E2E test files
  const e2eSourceDir = join(rootDir, 'test', 'e2e');
  const e2eTargetDir = join(tempDir, 'e2e');
  cpSync(e2eSourceDir, e2eTargetDir, { recursive: true });
  log('✅ Copied E2E test files');

  // Create package.json for the isolated test environment
  const testPackageJson = {
    name: '@releasekit/e2e-tests-isolated',
    version: '0.0.0',
    private: true,
    type: 'module',
    dependencies: {
      '@releasekit/core': `file:${tarballs.core}`,
      '@releasekit/config': `file:${tarballs.config}`,
      '@releasekit/notes': `file:${tarballs.notes}`,
      '@releasekit/publish': `file:${tarballs.publish}`,
      '@releasekit/version': `file:${tarballs.version}`,
      '@releasekit/release': `file:${tarballs.release}`,
      'conventional-changelog-angular': '^8.1.0',
      'conventional-changelog-conventionalcommits': '^9.0.0',
    },
    pnpm: {
      overrides: {
        '@releasekit/core': `file:${tarballs.core}`,
        '@releasekit/config': `file:${tarballs.config}`,
        '@releasekit/notes': `file:${tarballs.notes}`,
        '@releasekit/publish': `file:${tarballs.publish}`,
        '@releasekit/version': `file:${tarballs.version}`,
        '@releasekit/release': `file:${tarballs.release}`,
      },
    },
  };

  const packageJsonPath = join(e2eTargetDir, 'package.json');
  writeFileSync(packageJsonPath, JSON.stringify(testPackageJson, null, 2));
  log('✅ Created package.json');

  return tempDir;
}

function runTests(isolatedDir: string): void {
  const e2eDir = join(isolatedDir, 'e2e');

  // Install dependencies
  execCommand('pnpm install', e2eDir, 'Installing dependencies');

  // Run all .sh test files with RELEASEKIT_ROOT pointing to node_modules
  const testFiles = readdirSync(e2eDir).filter((f) => f.endsWith('.sh'));

  for (const testFile of testFiles) {
    log(`Running ${testFile}...`);
    try {
      const env = {
        ...process.env,
        RELEASEKIT_ROOT: join(e2eDir, 'node_modules'),
      };

      execSync(['bash', testFile].join(' '), {
        cwd: e2eDir,
        stdio: 'inherit',
        encoding: 'utf-8',
        shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
        env,
      });
      log(`✅ ${testFile} completed`);
    } catch (error) {
      console.error(`❌ ${testFile} failed:`);
      if (error instanceof Error) {
        console.error(error.message);
      }
      throw error;
    }
  }
}

function cleanup(tempDir: string): void {
  if (existsSync(tempDir)) {
    log('Cleaning up isolated test environment');
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      console.error(`⚠️  Failed to clean up temp directory: ${tempDir}`);
    }
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const skipBuild = args.includes('--skip-build');

  log(`Skip build: ${skipBuild}`);

  let tempDir: string | undefined;

  try {
    const tarballs = skipBuild ? findExistingTarballs() : await buildAndPackPackages();
    tempDir = createIsolatedEnvironment(tarballs);
    runTests(tempDir);
    log('🎉 All E2E tests passed!');
  } catch (error) {
    console.error('❌ E2E tests failed:');
    if (error instanceof Error) {
      console.error(error.message);
    }
    process.exit(1);
  } finally {
    if (tempDir) {
      cleanup(tempDir);
    }
  }
}

main().catch((error) => {
  console.error('❌ Unhandled error:');
  console.error(error);
  process.exit(1);
});
