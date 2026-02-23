#!/usr/bin/env tsx
/**
 * Script to run E2E tests in an isolated environment
 * Usage: pnpm tsx scripts/test-e2e.ts [--module-type=cjs|esm] [--skip-build]
 *
 * This script:
 * 1. Packs releasekit packages as tarballs
 * 2. Creates an isolated temp directory with pnpm isolation settings
 * 3. Copies E2E test files
 * 4. Generates package.json with CLI binaries exposed
 * 5. Installs dependencies from tarballs
 * 6. Runs vitest
 * 7. Cleans up
 */

import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
}

interface Options {
  moduleType: 'cjs' | 'esm';
  skipBuild: boolean;
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

  // Build all packages
  execCommand('pnpm build', rootDir, 'Building packages');

  // Pack each package
  const packages = ['core', 'config', 'version', 'notes', 'publish'];
  const tarballs: Partial<TarballPaths> = {};

  for (const pkg of packages) {
    const pkgDir = join(rootDir, 'packages', pkg);
    if (!existsSync(pkgDir)) {
      throw new Error(`Package directory not found: ${pkgDir}`);
    }
    execCommand('pnpm pack', pkgDir, `Packing @releasekit/${pkg}`);
  }

  // Find the tarballs
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

  const packages = ['core', 'config', 'version', 'notes', 'publish'];
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

function createIsolatedEnvironment(options: Options, tarballs: TarballPaths): string {
  const testId = Date.now();
  const tempDir = normalize(join(tmpdir(), `releasekit-e2e-isolated-${testId}`));

  log(`Creating isolated test environment at ${tempDir}`);
  mkdirSync(tempDir, { recursive: true });

  // Create .pnpmrc for isolation
  const pnpmrcPath = join(tempDir, '.pnpmrc');
  writeFileSync(pnpmrcPath, 'hoist=false\nnode-linker=isolated\n');
  log('✅ Created .pnpmrc with isolation settings');

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
    type: options.moduleType === 'esm' ? 'module' : 'commonjs',
    scripts: {
      test: 'vitest run',
    },
    dependencies: {
      '@releasekit/core': `file:${tarballs.core}`,
      '@releasekit/config': `file:${tarballs.config}`,
      '@releasekit/notes': `file:${tarballs.notes}`,
      '@releasekit/publish': `file:${tarballs.publish}`,
      '@releasekit/version': `file:${tarballs.version}`,
      'conventional-changelog-conventionalcommits': '^9.0.0',
    },
    devDependencies: {
      '@types/node': '^22.0.0',
      '@vitest/coverage-v8': '^3.0.0',
      typescript: '^5.0.0',
      vitest: '^3.0.0',
    },
    pnpm: {
      overrides: {
        '@releasekit/core': `file:${tarballs.core}`,
        '@releasekit/config': `file:${tarballs.config}`,
        '@releasekit/notes': `file:${tarballs.notes}`,
        '@releasekit/publish': `file:${tarballs.publish}`,
        '@releasekit/version': `file:${tarballs.version}`,
      },
    },
  };

  const packageJsonPath = join(e2eTargetDir, 'package.json');
  writeFileSync(packageJsonPath, JSON.stringify(testPackageJson, null, 2));
  log(`✅ Created package.json (type: ${options.moduleType})`);

  return tempDir;
}

function runTests(isolatedDir: string): void {
  const e2eDir = join(isolatedDir, 'e2e');

  // Install dependencies
  execCommand('pnpm install', e2eDir, 'Installing dependencies');

  // Run tests
  execCommand('pnpm test', e2eDir, 'Running E2E tests');
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
  // Parse arguments
  const args = process.argv.slice(2);
  const moduleTypeArg = args.find((arg) => arg.startsWith('--module-type='))?.split('=')[1];
  const moduleType: 'cjs' | 'esm' = moduleTypeArg === 'cjs' || moduleTypeArg === 'esm' ? moduleTypeArg : 'esm';
  const skipBuild = args.includes('--skip-build');

  log(`Module type: ${moduleType}`);
  log(`Skip build: ${skipBuild}`);

  let tempDir: string | undefined;

  try {
    // Get or create tarballs
    const tarballs = skipBuild ? findExistingTarballs() : await buildAndPackPackages();

    // Create isolated environment
    tempDir = createIsolatedEnvironment({ moduleType, skipBuild }, tarballs);

    // Run tests
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
