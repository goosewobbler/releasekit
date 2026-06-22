#!/usr/bin/env tsx
/**
 * Builds a throwaway consumer fixture for one examples smoke-test scenario
 * (issue #276). The fixture is a real git repo with conventional commits + a
 * tag, depending on locally-packed releasekit tarballs (so `pnpm exec
 * releasekit` resolves), and carrying the scenario's SHIPPED config so the dry
 * run exercises the same code path a consumer would hit.
 *
 * Usage:
 *   tsx scripts/examples-smoke/build-fixture.ts \
 *     --scenario <id> --out <dir> --tarball-dir <dir> [--seed-lockfile]
 *
 * `--seed-lockfile` runs `pnpm install --lockfile-only` so the example's
 * verbatim `pnpm install --frozen-lockfile` step has a lockfile to honour. It
 * needs pnpm on PATH, so it only runs in the prepare job (never in the smoke
 * job, which must start with pnpm ABSENT to catch a missing pnpm/action-setup).
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCENARIOS } from './scenarios.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = normalize(join(__dirname, '..', '..'));

const PACKAGES = ['core', 'config', 'version', 'notes', 'publish', 'release'] as const;

interface Args {
  scenario: string;
  out: string;
  tarballDir: string;
  seedLockfile: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Partial<Args> = { seedLockfile: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--scenario') args.scenario = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--tarball-dir') args.tarballDir = argv[++i];
    else if (a === '--seed-lockfile') args.seedLockfile = true;
  }
  if (!args.scenario || !args.out || !args.tarballDir) {
    throw new Error('Usage: build-fixture --scenario <id> --out <dir> --tarball-dir <dir> [--seed-lockfile]');
  }
  return args as Args;
}

function findTarball(dir: string, prefix: string): string {
  const file = readdirSync(dir).find((f) => f.startsWith(prefix) && f.endsWith('.tgz'));
  if (!file) throw new Error(`Could not find ${prefix}*.tgz in ${dir}`);
  return file;
}

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'inherit' });
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

/** `file:` deps + pnpm overrides pointing at the packed tarballs copied into the fixture. */
function tarballDeps(tarballNames: Record<string, string>): {
  deps: Record<string, string>;
  overrides: Record<string, string>;
} {
  const deps: Record<string, string> = {};
  const overrides: Record<string, string> = {};
  for (const pkg of PACKAGES) {
    const spec = `file:./.tarballs/${tarballNames[pkg]}`;
    deps[`@releasekit/${pkg}`] = spec;
    overrides[`@releasekit/${pkg}`] = spec;
  }
  return { deps, overrides };
}

function writeRootPackageJson(
  out: string,
  name: string,
  extra: Record<string, unknown>,
  tarballNames: Record<string, string>,
): void {
  const { deps, overrides } = tarballDeps(tarballNames);
  // Read the repo's pinned pnpm so the fixture's `packageManager` field matches
  // what the smoke job's pnpm/action-setup@v6 will resolve. The hash suffix
  // would be wrong on a different machine, so we keep just the `pnpm@X.Y.Z`
  // portion and let the action pick the latest patch.
  const repoPkg = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf-8')) as {
    packageManager?: string;
  };
  const packageManager = repoPkg.packageManager?.split('+')[0];
  writeJson(join(out, 'package.json'), {
    name,
    version: '1.0.0',
    private: true,
    type: 'module',
    ...(packageManager ? { packageManager } : {}),
    ...extra,
    dependencies: {
      ...deps,
      'conventional-changelog-angular': '^8.1.0',
      'conventional-changelog-conventionalcommits': '^9.0.0',
    },
    pnpm: { overrides },
  });
}

function buildNpmSingle(out: string, tarballNames: Record<string, string>): void {
  writeRootPackageJson(out, 'smoke-consumer', {}, tarballNames);
}

function buildNpmMonorepo(out: string, tarballNames: Record<string, string>): void {
  writeRootPackageJson(out, 'smoke-consumer-root', {}, tarballNames);
  writeFileSync(join(out, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n");

  // A single member package so releasekit has a workspace to walk. Names/paths
  // follow the smoke consumer's monorepo shape; the example's releasekit.config
  // is what actually decides which packages to release.
  for (const [dir, pkgName] of [['packages/js-lib', '@smoke/js-lib']] as const) {
    mkdirSync(join(out, dir), { recursive: true });
    writeJson(join(out, dir, 'package.json'), { name: pkgName, version: '1.0.0' });
  }
}

function buildNpmCargoMonorepo(out: string, tarballNames: Record<string, string>): void {
  writeRootPackageJson(out, 'smoke-consumer-root', {}, tarballNames);
  writeFileSync(join(out, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n");

  // Layout mirrors the monorepo-rust example config: packages/{js-lib,cli},
  // crates/{core,ffi}. Names/paths follow the shipped releasekit.config.json.
  for (const [dir, pkgName] of [
    ['packages/js-lib', '@smoke/js-lib'],
    ['packages/cli', '@smoke/cli'],
  ] as const) {
    mkdirSync(join(out, dir), { recursive: true });
    writeJson(join(out, dir, 'package.json'), { name: pkgName, version: '1.0.0' });
  }
  for (const [dir, crateName] of [
    ['crates/core', 'smoke-core'],
    ['crates/ffi', 'smoke-ffi'],
  ] as const) {
    mkdirSync(join(out, dir, 'src'), { recursive: true });
    writeFileSync(
      join(out, dir, 'Cargo.toml'),
      `[package]\nname = "${crateName}"\nversion = "1.0.0"\nedition = "2021"\n`,
    );
    writeFileSync(join(out, dir, 'src', 'lib.rs'), '');
  }
}

function main(): void {
  const { scenario: scenarioId, out, tarballDir, seedLockfile } = parseArgs(process.argv.slice(2));
  const scenario = SCENARIOS.find((s) => s.id === scenarioId);
  if (!scenario) throw new Error(`Unknown scenario: ${scenarioId}`);

  const outDir = resolve(out);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  // Copy the packed tarballs into the fixture so its file: deps are self-contained
  // (the smoke job downloads only the fixture artifact).
  const tarballsOut = join(outDir, '.tarballs');
  mkdirSync(tarballsOut, { recursive: true });
  const tarballNames: Record<string, string> = {};
  for (const pkg of PACKAGES) {
    const name = findTarball(resolve(tarballDir), `releasekit-${pkg}-`);
    cpSync(join(resolve(tarballDir), name), join(tarballsOut, name));
    tarballNames[pkg] = name;
  }

  switch (scenario.fixture) {
    case 'npm-single':
      buildNpmSingle(outDir, tarballNames);
      break;
    case 'npm-monorepo':
      buildNpmMonorepo(outDir, tarballNames);
      break;
    case 'npm-cargo-monorepo':
      buildNpmCargoMonorepo(outDir, tarballNames);
      break;
    default: {
      // Exhaustiveness check: adding a new fixture kind to scenarios.ts fails to
      // compile here until build-fixture.ts is taught how to build it.
      const _exhaustive: never = scenario.fixture;
      throw new Error(`Unhandled fixture kind: ${String(_exhaustive)}`);
    }
  }

  // Drop in the SHIPPED config for this scenario — this is what makes the dry run
  // faithful and keeps the runtime probe config-derived (see generate-smoke-workflow).
  cpSync(join(rootDir, 'examples', 'ci', scenarioId, scenario.config), join(outDir, 'releasekit.config.json'));

  // Conventional-commit history + a baseline tag so the dry run computes a bump.
  git(outDir, 'init', '-q', '-b', 'main');
  git(outDir, 'config', 'user.email', 'smoke@example.com');
  git(outDir, 'config', 'user.name', 'Smoke Test');
  git(outDir, 'add', '-A');
  git(outDir, 'commit', '-q', '-m', 'chore: scaffold smoke fixture');
  git(outDir, 'tag', 'v1.0.0');
  writeFileSync(join(outDir, 'FEATURE.md'), 'a releasable change\n');
  git(outDir, 'add', '-A');
  git(outDir, 'commit', '-q', '-m', 'feat: add a releasable change');

  if (seedLockfile) {
    // Generate pnpm-lock.yaml so the example's verbatim `pnpm install
    // --frozen-lockfile` has a lockfile to honour in the smoke job. The fixture
    // lives under .smoke-fixtures/, inside the monorepo; without
    // --ignore-workspace, pnpm walks up to pnpm-workspace.yaml, treats the
    // fixture as a workspace project, and writes its lockfile against the
    // monorepo root (no fixture-local pnpm-lock.yaml ever appears).
    execFileSync('pnpm', ['install', '--lockfile-only', '--ignore-scripts', '--ignore-workspace'], {
      cwd: outDir,
      stdio: 'inherit',
    });
    git(outDir, 'add', '-A');
    // Skip the commit when nothing is staged — pnpm's resolution can land on
    // the existing lockfile shape with no fixture-local changes to record.
    // `git diff --cached --quiet` exits 1 when there ARE staged changes.
    const hasStagedChanges = spawnSync('git', ['diff', '--cached', '--quiet'], { cwd: outDir }).status !== 0;
    if (hasStagedChanges) {
      git(outDir, 'commit', '-q', '-m', 'chore: seed lockfile');
    }
  }

  console.log(`Built ${scenario.fixture} fixture for "${scenarioId}" at ${outDir}`);
}

main();
