#!/usr/bin/env tsx
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stringify as stringifyYaml } from 'yaml';
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
    if (a === '--scenario') {
      args.scenario = argv[++i];
    } else if (a === '--out') {
      args.out = argv[++i];
    } else if (a === '--tarball-dir') {
      args.tarballDir = argv[++i];
    } else if (a === '--seed-lockfile') {
      args.seedLockfile = true;
    }
  }
  if (!args.scenario || !args.out || !args.tarballDir) {
    throw new Error('Usage: build-fixture --scenario <id> --out <dir> --tarball-dir <dir> [--seed-lockfile]');
  }
  return args as Args;
}

function findTarball(dir: string, prefix: string): string {
  const file = readdirSync(dir).find((f) => f.startsWith(prefix) && f.endsWith('.tgz'));
  if (!file) {
    throw new Error(`Could not find ${prefix}*.tgz in ${dir}`);
  }
  return file;
}

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'inherit' });
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

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

function writeRootManifests(
  out: string,
  name: string,
  extra: Record<string, unknown>,
  tarballNames: Record<string, string>,
  workspacePackages?: string[],
): void {
  const { deps, overrides } = tarballDeps(tarballNames);
  // Match the repo's pinned pnpm so the fixture's `packageManager` agrees with
  // what the smoke job's pnpm/action-setup resolves. The hash suffix would be
  // wrong on a different machine, so keep just `pnpm@X.Y.Z`.
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
    dependencies: deps,
  });
  // pnpm 11+ ignores package.json's `pnpm` field, so the overrides go in pnpm-workspace.yaml.
  writeFileSync(
    join(out, 'pnpm-workspace.yaml'),
    stringifyYaml({ ...(workspacePackages ? { packages: workspacePackages } : {}), overrides }),
  );
}

function buildNpmSingle(out: string, tarballNames: Record<string, string>): void {
  // A private single package is skipped at discovery, leaving nothing to release.
  writeRootManifests(out, 'smoke-consumer', { private: false }, tarballNames);
}

function buildNpmMonorepo(out: string, tarballNames: Record<string, string>): void {
  writeRootManifests(out, 'smoke-consumer-root', {}, tarballNames, ['packages/*']);

  // One member so releasekit has a workspace to walk.
  for (const [dir, pkgName] of [['packages/js-lib', '@smoke/js-lib']] as const) {
    mkdirSync(join(out, dir), { recursive: true });
    writeJson(join(out, dir, 'package.json'), { name: pkgName, version: '1.0.0' });
  }
}

function buildNpmCargoMonorepo(out: string, tarballNames: Record<string, string>): void {
  writeRootManifests(out, 'smoke-consumer-root', {}, tarballNames, ['packages/*']);

  // Paths must match the monorepo-rust example's releasekit.config.json.
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
  if (!scenario) {
    throw new Error(`Unknown scenario: ${scenarioId}`);
  }

  const outDir = resolve(out);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  // The smoke job downloads only the fixture artifact, so its file: deps must be self-contained.
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
      const _exhaustive: never = scenario.fixture;
      throw new Error(`Unhandled fixture kind: ${String(_exhaustive)}`);
    }
  }

  // The shipped config, so the dry run hits the same code path a consumer would.
  cpSync(join(rootDir, 'examples', 'ci', scenarioId, scenario.config), join(outDir, 'releasekit.config.json'));

  // Conventional-commit history & a baseline tag so the dry run computes a bump.
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
    // Gives the example's verbatim `pnpm install --frozen-lockfile` a lockfile to
    // honour. Needs pnpm on PATH, so only the prepare job passes --seed-lockfile:
    // the smoke job must start without pnpm to catch a missing pnpm/action-setup.
    // The fixture's own pnpm-workspace.yaml keeps pnpm from walking up to the
    // monorepo root; --ignore-workspace would also drop the overrides it carries.
    execFileSync('pnpm', ['install', '--lockfile-only', '--ignore-scripts'], {
      cwd: outDir,
      stdio: 'inherit',
    });
    git(outDir, 'add', '-A');
    // pnpm's resolution can leave nothing new to commit.
    const hasStagedChanges = spawnSync('git', ['diff', '--cached', '--quiet'], { cwd: outDir }).status !== 0;
    if (hasStagedChanges) {
      git(outDir, 'commit', '-q', '-m', 'chore: seed lockfile');
    }
  }

  console.log(`Built ${scenario.fixture} fixture for "${scenarioId}" at ${outDir}`);
}

main();
