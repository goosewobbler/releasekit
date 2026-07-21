#!/usr/bin/env node
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
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

export function buildReleaseArgs(input) {
  const args = ['release'];

  pushOptionalArg(args, '--config', input.config);
  pushOptionalArg(args, '--project-dir', input.projectDir);
  pushOptionalArg(args, '--bump', input.bump);
  pushOptionalArg(args, '--target', input.target);
  pushOptionalArg(args, '--scope', input.scope);
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
  pushBooleanFlag(args, '--stable', input.stable);

  return args;
}

export function buildPreviewArgs(input) {
  const args = ['preview'];

  pushOptionalArg(args, '--config', input.config);
  pushOptionalArg(args, '--project-dir', input.projectDir);
  pushOptionalArg(args, '--pr', input.pr);
  pushOptionalArg(args, '--repo', input.repo);
  pushOptionalArg(args, '--target', input.previewTarget);

  if (input.previewPrerelease) {
    args.push('--prerelease', input.previewPrerelease);
  }

  pushBooleanFlag(args, '--stable', input.previewStable);
  const effectivePreviewDryRun = normalizeBoolean(input.previewDryRun) || normalizeBoolean(input.dryRun);
  if (effectivePreviewDryRun) {
    args.push('--dry-run');
  }

  return args;
}

export function buildStandingPRUpdateArgs(input) {
  const args = ['standing-pr', 'update'];

  args.push('--json');
  pushOptionalArg(args, '--config', input.config);
  pushOptionalArg(args, '--project-dir', input.projectDir);
  pushOptionalArg(args, '--npm-auth', input.npmAuth);
  pushBooleanFlag(args, '--reconcile', input.reconcile);
  pushBooleanFlag(args, '--verbose', input.verbose);
  pushBooleanFlag(args, '--quiet', input.quiet);

  return args;
}

export function buildStandingPRPublishArgs(input) {
  const args = ['standing-pr', 'publish'];

  args.push('--json');
  pushOptionalArg(args, '--config', input.config);
  pushOptionalArg(args, '--project-dir', input.projectDir);
  pushOptionalArg(args, '--npm-auth', input.npmAuth);
  // Dispatch-funnelled publishes (gh workflow run from standing-pr.yml) run on a
  // workflow_dispatch event with no pull_request payload, so the merged standing PR's
  // number has to be carried across the dispatch boundary explicitly.
  pushOptionalArg(args, '--pr', input.pr);
  pushBooleanFlag(args, '--verbose', input.verbose);
  pushBooleanFlag(args, '--quiet', input.quiet);

  return args;
}

export function buildGateArgs(input) {
  const args = ['gate'];

  args.push('--json');
  pushOptionalArg(args, '--config', input.config);
  pushOptionalArg(args, '--project-dir', input.projectDir);
  pushOptionalArg(args, '--scope', input.scope);
  pushBooleanFlag(args, '--verbose', input.verbose);
  pushBooleanFlag(args, '--quiet', input.quiet);

  return args;
}

export function buildBackfillArgs(input) {
  const args = ['backfill'];

  // backfill has no --project-dir flag; the runner already spawns the CLI with cwd = projectDir.
  pushOptionalArg(args, '--config', input.config);
  pushOptionalArg(args, '--package', input.backfillPackage);
  pushOptionalArg(args, '--path', input.backfillPath);
  pushOptionalArg(args, '--from', input.backfillFrom);
  pushOptionalArg(args, '--to', input.backfillTo);
  pushBooleanFlag(args, '--all', input.backfillAll);
  pushBooleanFlag(args, '--update-releases', input.backfillUpdateReleases);
  pushBooleanFlag(args, '--only-missing', input.backfillOnlyMissing);
  pushBooleanFlag(args, '--apply', input.backfillApply);

  return args;
}

export function buildRefreshAfterReleaseArgs(input) {
  const args = ['refresh-after-release'];

  pushOptionalArg(args, '--config', input.config);
  pushOptionalArg(args, '--project-dir', input.projectDir);

  return args;
}

export function writeGateOutputs(stdout, verbose = false) {
  const parsed = parseReleaseOutput(stdout, verbose);
  setOutput('should-release', parsed?.shouldRelease ? 'true' : 'false');
  setOutput('bump', parsed?.bump ?? '');
  setOutput('gate-scope', parsed?.scope ?? '');
  setOutput('gate-target', parsed?.target ?? '');
  setOutput('gate-stable', parsed?.stable ? 'true' : 'false');
}

export function parseReleaseOutput(stdout, verbose = false) {
  const trimmed = stdout.trim();
  if (!trimmed) return undefined;
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch (err) {
    if (verbose) {
      console.error(`[run-action] Failed to parse JSON output: ${err.message}`);
    }
    return undefined;
  }
  // The CLI wraps every result in the uniform envelope { schemaVersion, status, data, ... }; unwrap
  // to the data payload so output derivation reads result fields (versionOutput, shouldRelease)
  // directly. Legacy un-enveloped output is returned as-is for backward compatibility.
  if (parsed && typeof parsed === 'object' && 'schemaVersion' in parsed && 'data' in parsed) {
    return parsed.data;
  }
  return parsed;
}

// Sync-mode version tags on HEAD, straight from git. The release creates them at HEAD, so they
// survive a stdout-capture hiccup that would empty the parsed JSON — the authoritative fallback for
// the `tags` output. Per-package tag formats aren't matched here and still rely on the parsed output.
function gitVersionTagsAtHead(cwd) {
  try {
    const out = execFileSync('git', ['tag', '--points-at', 'HEAD'], { cwd, encoding: 'utf8' });
    return out
      .split('\n')
      .map((tag) => tag.trim())
      .filter((tag) => /^v\d+\.\d+\.\d+/.test(tag));
  } catch {
    return [];
  }
}

// Pure tag selection, testable without git or GITHUB_OUTPUT. Prefer the parsed release output; only
// when recovery is allowed (json output was expected but couldn't be parsed — see writeReleaseOutputs)
// do we fall back to git's authoritative tags so a stdout hiccup can't silently empty `tags`.
// `recovered` flags that fallback so the caller can surface it.
export function resolveReleaseTags({ parsedTags, gitTags, allowRecovery }) {
  const parsed = Array.isArray(parsedTags) ? parsedTags : [];
  if (parsed.length > 0 || !allowRecovery) {
    return { tags: parsed, recovered: false };
  }
  const git = Array.isArray(gitTags) ? gitTags : [];
  return git.length > 0 ? { tags: git, recovered: true } : { tags: [], recovered: false };
}

function setOutput(name, value) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) return;

  const text = value === undefined ? '' : String(value);
  const delimiter = `releasekit_${randomBytes(8).toString('hex')}`;
  const block = `${name}<<${delimiter}\n${text}\n${delimiter}\n`;
  try {
    fs.appendFileSync(outputPath, block);
  } catch (err) {
    throw new Error(`Failed to write output '${name}': ${err.message}`);
  }
}

function setFailure(errorMessage) {
  const msg = errorMessage || 'ReleaseKit action failed';
  process.stderr.write(`${msg}\n`);
  process.exit(1);
}

export function parseInputs(env = process.env) {
  const input = {
    mode: normalizeString(env.INPUT_MODE) ?? 'preview',
    config: normalizeString(env.INPUT_CONFIG),
    projectDir: normalizeString(env.INPUT_PROJECT_DIR) ?? '.',
    dryRun: env.INPUT_DRY_RUN,
    json: env.INPUT_JSON,
    verbose: env.INPUT_VERBOSE,
    quiet: env.INPUT_QUIET,
    summary: env.INPUT_SUMMARY,

    bump: normalizeString(env.INPUT_BUMP),
    prerelease: normalizeString(env.INPUT_PRERELEASE),
    stable: env.INPUT_STABLE,
    sync: env.INPUT_SYNC,
    target: normalizeString(env.INPUT_TARGET),
    scope: normalizeString(env.INPUT_SCOPE),
    branch: normalizeString(env.INPUT_BRANCH),
    npmAuth: normalizeString(env.INPUT_NPM_AUTH) ?? 'auto',
    skipNotes: env.INPUT_SKIP_NOTES,
    skipPublish: env.INPUT_SKIP_PUBLISH,
    skipGit: env.INPUT_SKIP_GIT,
    skipGithubRelease: env.INPUT_SKIP_GITHUB_RELEASE,
    skipVerification: env.INPUT_SKIP_VERIFICATION,

    reconcile: env.INPUT_RECONCILE,
    pr: normalizeString(env.INPUT_PR),
    repo: normalizeString(env.INPUT_REPO),
    previewPrerelease: normalizeString(env.INPUT_PREVIEW_PRERELEASE),
    previewStable: env.INPUT_PREVIEW_STABLE,
    previewDryRun: env.INPUT_PREVIEW_DRY_RUN,
    previewTarget: normalizeString(env.INPUT_PREVIEW_TARGET),

    backfillPackage: normalizeString(env.INPUT_PACKAGE),
    backfillPath: normalizeString(env.INPUT_PATH),
    backfillAll: env.INPUT_ALL,
    backfillFrom: normalizeString(env.INPUT_FROM),
    backfillTo: normalizeString(env.INPUT_TO),
    backfillUpdateReleases: env.INPUT_UPDATE_RELEASES,
    backfillOnlyMissing: env.INPUT_ONLY_MISSING,
    backfillApply: env.INPUT_APPLY,
  };

  const validModes = [
    'release',
    'preview',
    'gate',
    'standing-pr-update',
    'standing-pr-publish',
    'backfill',
    'refresh-after-release',
  ];
  if (!validModes.includes(input.mode)) {
    throw new Error(`Invalid mode: ${input.mode}. Must be one of: ${validModes.join(', ')}`);
  }

  return input;
}

export async function runAction(input, options = {}) {
  const mode = input.mode;
  const validModes = [
    'release',
    'preview',
    'gate',
    'standing-pr-update',
    'standing-pr-publish',
    'backfill',
    'refresh-after-release',
  ];
  if (!validModes.includes(mode)) {
    throw new Error(`Invalid mode: ${mode}. Expected one of: ${validModes.join(', ')}.`);
  }

  const cliPath =
    options.cliPath ??
    path.resolve(fileURLToPath(import.meta.url), '..', '..', 'packages', 'release', 'dist', 'cli.js');

  const argBuilders = {
    release: buildReleaseArgs,
    gate: buildGateArgs,
    'standing-pr-update': buildStandingPRUpdateArgs,
    'standing-pr-publish': buildStandingPRPublishArgs,
    backfill: buildBackfillArgs,
    preview: buildPreviewArgs,
    'refresh-after-release': buildRefreshAfterReleaseArgs,
  };
  // `mode` is validated against validModes above, and every entry has a key here.
  const args = argBuilders[mode](input);

  // Capture the JSON-result modes' structured output via a temp file (--output) instead of scraping
  // stdout, which subprocess/log noise can corrupt — a single stray byte breaks JSON.parse. The CLI
  // writes the result JSON to this file; we read it back after the run (see the `close` handler).
  const OUTPUT_MODES = new Set(['release', 'gate', 'standing-pr-update', 'standing-pr-publish']);
  let outputFile;
  let outputDir;
  if (OUTPUT_MODES.has(mode)) {
    outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'releasekit-action-'));
    outputFile = path.join(outputDir, 'result.json');
    args.push('--output', outputFile);
  }

  const projectDir = input.projectDir || '.';
  const actionDir = fileURLToPath(import.meta.url).replace(/[/\\]scripts[/\\]run-action.mjs$/, '');

  let resolvedProjectDir;
  if (path.isAbsolute(projectDir)) {
    resolvedProjectDir = projectDir;
  } else if (projectDir === '.') {
    resolvedProjectDir = process.cwd();
  } else {
    resolvedProjectDir = path.resolve(process.cwd(), projectDir);
  }

  // Validate project directory exists and is a directory
  try {
    const stats = fs.statSync(resolvedProjectDir);
    if (!stats.isDirectory()) {
      throw new Error(`Project directory is not a directory: ${resolvedProjectDir}`);
    }
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error(`Project directory does not exist: ${resolvedProjectDir}`);
    }
    throw err;
  }

  if (normalizeBoolean(input.verbose)) {
    console.log(`[run-action] Resolved project directory: ${resolvedProjectDir}`);
    console.log(`[run-action] CLI path: ${cliPath}`);
  }

  const actionNodeModules = path.join(actionDir, 'node_modules');
  const actionPnpmStore = path.join(actionDir, 'node_modules', '.pnpm');

  const userNodeModules = path.join(resolvedProjectDir, 'node_modules');

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
              } catch {
                if (normalizeBoolean(input.verbose)) {
                  console.warn(`[run-action] Skipping invalid node_modules path: ${pkgNodeModules}`);
                }
              }
            }
          }
        }
      } catch {
        if (normalizeBoolean(input.verbose)) {
          console.warn(`[run-action] Skipping invalid node path base: ${base}`);
        }
      }
    }
    return paths;
  }

  const nodePaths = collectNodePaths([actionNodeModules, actionPnpmStore, userNodeModules])
    .filter((p) => {
      try {
        fs.accessSync(p);
        return true;
      } catch {
        return false;
      }
    })
    .join(':');

  if (normalizeBoolean(input.verbose)) {
    console.log(`[run-action] NODE_PATH: ${nodePaths}`);
  }

  const spawnEnv = {
    ...process.env,
    NODE_PATH: nodePaths,
    PNPM_HOME: process.env.PNPM_HOME,
  };
  for (const k of Object.keys(spawnEnv).filter((k) => k.startsWith('INPUT_'))) {
    delete spawnEnv[k];
  }

  // Stream child stdout/stderr live to the parent process so progress is visible in
  // CI logs as it happens, while also collecting both into buffers for downstream
  // parsing (--json output, summary generation, etc.). Using spawnSync here would
  // buffer everything until the child exits, which masks where long-running steps
  // (publish, verify) actually are.
  return new Promise((resolve, reject) => {
    const child = spawn('node', [cliPath, ...args], {
      env: spawnEnv,
      cwd: resolvedProjectDir,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.setEncoding('utf-8');
    child.stderr.setEncoding('utf-8');

    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      process.stdout.write(chunk);
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      process.stderr.write(chunk);
    });

    child.on('error', (err) => {
      child.stdout.destroy();
      child.stderr.destroy();
      reject(new Error(`Spawn error: ${err.message}`));
    });

    child.on('close', (status, signal) => {
      // Prefer the --output file (reliable) over captured stdout for the structured result.
      let outputJson = '';
      if (outputFile) {
        try {
          outputJson = fs.readFileSync(outputFile, 'utf-8');
        } catch {
          outputJson = '';
        }
        try {
          fs.rmSync(outputDir, { recursive: true, force: true });
        } catch {
          // best-effort temp cleanup
        }
      }
      resolve({ mode, args, status, signal, stdout, stderr, outputJson });
    });
  });
}

function writeCoreOutputs(mode, success) {
  setOutput('mode', mode);
  setOutput('success', success ? 'true' : 'false');
}

function writeReleaseOutputs(input, stdout) {
  const jsonMode = normalizeBoolean(input.json);
  const parsed = jsonMode ? parseReleaseOutput(stdout, normalizeBoolean(input.verbose)) : undefined;
  const hasChanges = !!parsed?.versionOutput?.updates?.length;
  setOutput('has-changes', hasChanges ? 'true' : 'false');
  setOutput('release-output', parsed ? JSON.stringify(parsed) : '');

  const versionOutput = parsed?.versionOutput ? JSON.stringify(parsed.versionOutput) : '';
  setOutput('version-output', versionOutput);

  // Recover `tags` from git only when json output was expected but did not parse — a stdout hiccup
  // must not silently empty it. Never when json mode is off (no parse was attempted, so an empty
  // `tags` is intentional), on a dry run (nothing tagged), or with --skip-git (a version tag on HEAD
  // would be the *previous* release's, not this run's).
  const allowRecovery =
    jsonMode && parsed === undefined && !normalizeBoolean(input.dryRun) && !normalizeBoolean(input.skipGit);
  const parsedTags = parsed?.versionOutput?.tags;
  const gitTags = allowRecovery ? gitVersionTagsAtHead(input.projectDir ?? '.') : [];
  const { tags, recovered } = resolveReleaseTags({ parsedTags, gitTags, allowRecovery });
  if (recovered) {
    console.log(
      '::warning::releasekit: recovered the `tags` output from git after the release JSON output could not be parsed — check this run for a stdout capture issue',
    );
  }
  setOutput('tags', tags.join(','));
}

function writePreviewOutputs(input, stdout) {
  const dryRun = normalizeBoolean(input.previewDryRun) || normalizeBoolean(input.dryRun);
  setOutput('preview-posted', dryRun ? 'false' : 'true');
  setOutput('preview-markdown', dryRun ? stdout : '');
}

export function writeStandingPROutputs(stdout, verbose = false) {
  const parsed = parseReleaseOutput(stdout, verbose);
  setOutput('standing-pr-action', parsed?.action ?? '');
  setOutput('standing-pr-number', parsed?.prNumber !== undefined ? String(parsed.prNumber) : '');
  setOutput('standing-pr-url', parsed?.prUrl ?? '');
}

export function writeSummary(markdown) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;
  try {
    fs.appendFileSync(summaryPath, markdown);
  } catch (err) {
    throw new Error(`Failed to write summary: ${err.message}`);
  }
}

export function buildReleaseSummary(input, parsed, success) {
  const lines = [];

  if (!success) {
    lines.push('## :x: Release Failed');
    lines.push('');
    lines.push('The release pipeline encountered an error and did not complete.');
    lines.push('');
    return lines.join('\n');
  }

  const isDryRun = normalizeBoolean(input.dryRun);
  if (isDryRun) {
    lines.push('## :warning: Dry Run');
    lines.push('');
    lines.push('No changes were published. This was a dry run.');
    lines.push('');
  } else {
    lines.push('## :rocket: Release');
    lines.push('');
  }

  const settings = [];
  if (input.bump) settings.push(`| Bump | \`${input.bump}\` |`);
  if (input.target) settings.push(`| Target | \`${input.target}\` |`);
  if (input.scope) settings.push(`| Scope | \`${input.scope}\` |`);
  if (input.prerelease) settings.push(`| Prerelease | \`${input.prerelease}\` |`);
  if (normalizeBoolean(input.stable)) settings.push(`| Stable | Yes |`);

  if (settings.length > 0) {
    lines.push('| Setting | Value |');
    lines.push('|---------|-------|');
    lines.push(settings.join('\n'));
    lines.push('');
  }

  const updates = parsed?.versionOutput?.updates;
  if (updates && updates.length > 0) {
    lines.push('### Package Updates');
    lines.push('');
    lines.push('| Package | Version |');
    lines.push('|---------|---------|');
    for (const update of updates) {
      lines.push(`| \`${update.packageName}\` | \`${update.newVersion}\` |`);
    }
    lines.push('');
  } else if (!isDryRun) {
    lines.push('> :information_source: No packages were updated.');
    lines.push('');
  }

  const tags = parsed?.versionOutput?.tags;
  if (Array.isArray(tags) && tags.length > 0) {
    lines.push('### Tags');
    lines.push('');
    for (const tag of tags) {
      lines.push(`- \`${tag}\``);
    }
    lines.push('');
  }

  return lines.join('\n');
}

export function buildGateSummary(_input, parsed, success) {
  const lines = [];

  // Show error banner if the gate step itself failed (not just shouldRelease=false)
  if (!success) {
    lines.push('## :x: Gate Failed');
    lines.push('');
    lines.push('The gate check encountered an error and did not complete.');
    lines.push('');
    if (parsed?.reason) {
      lines.push(`> **Error**: ${parsed.reason}`);
      lines.push('');
    }
    return lines.join('\n');
  }

  lines.push('## :mag: Gate Check');
  lines.push('');

  const shouldRelease = parsed?.shouldRelease === true;
  const icon = shouldRelease ? ':white_check_mark:' : ':x:';
  lines.push(`| Check | Result |`);
  lines.push(`|-------|--------|`);
  lines.push(`| Should release | ${icon} ${shouldRelease ? 'Yes' : 'No'} |`);
  if (parsed?.bump) lines.push(`| Bump | \`${parsed.bump}\` |`);
  if (parsed?.scope) lines.push(`| Scope | \`${parsed.scope}\` |`);
  if (parsed?.target) lines.push(`| Target | \`${parsed.target}\` |`);
  lines.push('');

  if (parsed?.blocked) {
    lines.push(`> :no_entry: **Blocked**: ${parsed.reason}`);
    lines.push('');
  } else if (!shouldRelease && parsed?.reason) {
    lines.push(`> :information_source: ${parsed.reason}`);
    lines.push('');
  }

  if (parsed?.labels && parsed.labels.length > 0) {
    lines.push(`**Labels**: ${parsed.labels.map((l) => `\`${l}\``).join(', ')}`);
    lines.push('');
  }

  if (parsed?.prNumbers && parsed.prNumbers.length > 0) {
    lines.push(`**PRs**: ${parsed.prNumbers.map((n) => `#${n}`).join(', ')}`);
    lines.push('');
  }

  return lines.join('\n');
}

async function main() {
  const input = parseInputs();
  const result = await runAction(input);
  const success = result.status === 0;
  const verbose = normalizeBoolean(input.verbose);

  // The structured result comes from the --output file for the JSON-result modes (reliable), falling
  // back to captured stdout for the rest (preview) and if the file is missing.
  const structured = result.outputJson || (result.stdout ?? '');

  // parsed is used for release/preview output; gateParsed is parsed separately for gate output
  const parsed = normalizeBoolean(input.json) ? parseReleaseOutput(structured, verbose) : undefined;

  // Write summary BEFORE setFailure (which calls process.exit)
  if (normalizeBoolean(input.summary, true)) {
    if (result.mode === 'release') {
      writeSummary(buildReleaseSummary(input, parsed, success));
    } else if (result.mode === 'gate') {
      const gateParsed = parseReleaseOutput(structured, verbose);
      writeSummary(buildGateSummary(input, gateParsed, success));
    }
  }

  // Write outputs. Child stdout/stderr were already streamed live during runAction,
  // so we don't re-emit them here — the buffers in `result` are only used for parsing.
  if (!success) {
    writeCoreOutputs(result.mode, false);
    if (result.mode === 'gate') {
      writeGateOutputs(structured, verbose);
    } else if (result.mode === 'standing-pr-update' || result.mode === 'standing-pr-publish') {
      writeStandingPROutputs(structured, verbose);
    }
    setFailure(`ReleaseKit ${result.mode} failed with exit code ${result.status ?? 1}`);
  }

  writeCoreOutputs(result.mode, true);

  if (result.mode === 'release') {
    writeReleaseOutputs(input, structured);
  } else if (result.mode === 'gate') {
    writeGateOutputs(structured, verbose);
  } else if (result.mode === 'standing-pr-update' || result.mode === 'standing-pr-publish') {
    writeStandingPROutputs(structured, verbose);
  } else if (result.mode === 'backfill' || result.mode === 'refresh-after-release') {
    // These stream their own progress and expose only the core success/mode outputs.
  } else {
    writePreviewOutputs(input, result.stdout ?? '');
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((err) => {
    process.stderr.write(`[run-action] uncaught error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
