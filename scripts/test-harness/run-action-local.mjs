import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function normalizeBoolean(value, defaultValue = false) {
  if (value === undefined || value === '') return defaultValue;
  return value === 'true';
}

function normalizeString(value) {
  return value === undefined || value === '' ? undefined : value;
}

function pushOptionalArg(args, flag, value) {
  const normalized = normalizeString(value);
  if (normalized !== undefined) {
    args.push(flag, normalized);
  }
}

function pushBooleanFlag(args, flag, value, defaultValue = false) {
  if (normalizeBoolean(value, defaultValue)) {
    args.push(flag);
  }
}

function buildReleaseArgs(input) {
  const args = ['release'];

  pushOptionalArg(args, '--config', input.config);
  pushOptionalArg(args, '--project-dir', input.projectDir);
  pushOptionalArg(args, '--bump', input.bump);
  pushOptionalArg(args, '--target', input.target);
  pushOptionalArg(args, '--branch', input.branch);
  pushOptionalArg(args, '--npm-auth', input.npmAuth);

  if (input.prerelease) {
    args.push('--prerelease', input.prerelease);
  }

  pushBooleanFlag(args, '--dry-run', input.dryRun);
  pushBooleanFlag(args, '--sync', input.sync);
  pushBooleanFlag(args, '--skip-notes', input.skipNotes);
  pushBooleanFlag(args, '--skip-publish', input.skipPublish);
  pushBooleanFlag(args, '--skip-git', input.skipGit);
  pushBooleanFlag(args, '--skip-github-release', input.skipGithubRelease);
  pushBooleanFlag(args, '--skip-verification', input.skipVerification);
  pushBooleanFlag(args, '--json', input.json);
  pushBooleanFlag(args, '--verbose', input.verbose);
  pushBooleanFlag(args, '--quiet', input.quiet);

  return args;
}

function buildPreviewArgs(input) {
  const args = ['preview'];

  pushOptionalArg(args, '--config', input.config);
  pushOptionalArg(args, '--project-dir', input.projectDir);
  pushOptionalArg(args, '--pr', input.pr);
  pushOptionalArg(args, '--repo', input.repo);

  if (input.previewPrerelease) {
    args.push('--prerelease', input.previewPrerelease);
  }

  pushBooleanFlag(args, '--stable', input.previewStable);
  const effectivePreviewDryRun = normalizeBoolean(input.previewDryRun) || normalizeBoolean(input.dryRun);
  if (effectivePreviewDryRun) {
    args.push('--dry-run');
  }
  pushBooleanFlag(args, '--verbose', input.verbose);
  pushBooleanFlag(args, '--quiet', input.quiet);

  return args;
}

export function parseReleaseOutput(stdout) {
  const trimmed = stdout.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

export function parseInputs(env = process.env) {
  return {
    mode: normalizeString(env.INPUT_MODE) ?? 'preview',
    config: normalizeString(env.INPUT_CONFIG),
    projectDir: normalizeString(env.INPUT_PROJECT_DIR) ?? '.',
    dryRun: env.INPUT_DRY_RUN,
    json: env.INPUT_JSON,
    verbose: env.INPUT_VERBOSE,
    quiet: env.INPUT_QUIET,

    bump: normalizeString(env.INPUT_BUMP),
    prerelease: normalizeString(env.INPUT_PRERELEASE),
    sync: env.INPUT_SYNC,
    target: normalizeString(env.INPUT_TARGET),
    branch: normalizeString(env.INPUT_BRANCH),
    npmAuth: normalizeString(env.INPUT_NPM_AUTH) ?? 'auto',
    skipNotes: env.INPUT_SKIP_NOTES,
    skipPublish: env.INPUT_SKIP_PUBLISH,
    skipGit: env.INPUT_SKIP_GIT,
    skipGithubRelease: env.INPUT_SKIP_GITHUB_RELEASE,
    skipVerification: env.INPUT_SKIP_VERIFICATION,

    pr: normalizeString(env.INPUT_PR),
    repo: normalizeString(env.INPUT_REPO),
    previewPrerelease: normalizeString(env.INPUT_PREVIEW_PRERELEASE),
    previewStable: env.INPUT_PREVIEW_STABLE,
    previewDryRun: env.INPUT_PREVIEW_DRY_RUN,
  };
}

export function runActionLocal(inputWithEnvVars, options = {}) {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const actionDir = options.actionDir ?? path.resolve(scriptDir, '..', '..');
  const cliPath = path.join(actionDir, 'packages', 'release', 'dist', 'cli.js');

  if (!fs.existsSync(cliPath)) {
    throw new Error(`CLI not found at: ${cliPath}. Run "pnpm build" first.`);
  }

  const spawnEnv = {
    ...process.env,
    ...inputWithEnvVars,
  };

  const input = parseInputs(inputWithEnvVars);
  const mode = input.mode;
  if (mode !== 'release' && mode !== 'preview') {
    throw new Error(`Invalid mode: ${mode}. Expected "release" or "preview".`);
  }

  for (const k of Object.keys(spawnEnv).filter((k) => k.startsWith('INPUT_'))) {
    delete spawnEnv[k];
  }

  const args = mode === 'release' ? buildReleaseArgs(input) : buildPreviewArgs(input);

  const projectDir = input.projectDir || '.';
  let resolvedProjectDir;
  if (path.isAbsolute(projectDir)) {
    resolvedProjectDir = projectDir;
  } else if (projectDir === '.') {
    resolvedProjectDir = process.cwd();
  } else {
    resolvedProjectDir = path.resolve(process.cwd(), projectDir);
  }

  const userNodeModules = path.join(resolvedProjectDir, 'node_modules');
  const userPnpmStore = path.join(resolvedProjectDir, 'node_modules', '.pnpm');

  function collectNodePaths(baseDirs) {
    const paths = [];
    for (const base of baseDirs) {
      paths.push(base);
      try {
        if (base.includes('.pnpm')) {
          const entries = fs.readdirSync(base, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.isDirectory()) {
              const pkgNodeModules = path.join(base, entry.name, 'node_modules');
              try {
                fs.accessSync(pkgNodeModules);
                paths.push(pkgNodeModules);
              } catch {}
            }
          }
        }
      } catch {}
    }
    return paths;
  }

  const nodePaths = collectNodePaths([userNodeModules, userPnpmStore])
    .filter((p) => {
      try {
        fs.accessSync(p);
        return true;
      } catch {
        return false;
      }
    })
    .join(':');

  const finalSpawnEnv = {
    ...spawnEnv,
    NODE_PATH: nodePaths,
    PNPM_HOME: process.env.PNPM_HOME,
  };

  const result = spawnSync('node', [cliPath, ...args], {
    encoding: 'utf-8',
    env: finalSpawnEnv,
    cwd: resolvedProjectDir,
  });

  return { mode, args, ...result };
}
