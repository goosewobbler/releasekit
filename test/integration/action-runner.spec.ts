import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildBackfillArgs,
  buildGateArgs,
  buildGateSummary,
  buildPreviewArgs,
  buildRefreshAfterReleaseArgs,
  buildReleaseArgs,
  buildReleaseSummary,
  buildStandingPRPublishArgs,
  buildStandingPRUpdateArgs,
  parseInputs,
  parseReleaseOutput,
  resolveReleaseTags,
  runAction,
} from '../../scripts/run-action.mjs';

describe('action runner', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  it('should build release args from inputs', () => {
    const args = buildReleaseArgs({
      config: 'releasekit.config.json',
      projectDir: '.',
      bump: 'minor',
      prerelease: 'next',
      sync: 'true',
      branch: 'main',
      npmAuth: 'oidc',
      skipNotes: 'true',
      skipPublish: 'false',
      skipGit: 'true',
      skipGithubRelease: 'false',
      skipVerification: 'true',
      dryRun: 'true',
      json: 'true',
      verbose: 'true',
      quiet: 'false',
    });

    expect(args).toEqual(
      expect.arrayContaining([
        'release',
        '--config',
        'releasekit.config.json',
        '--project-dir',
        '.',
        '--bump',
        'minor',
        '--prerelease',
        'next',
        '--sync',
        '--branch',
        'main',
        '--npm-auth',
        'oidc',
        '--skip-notes',
        '--skip-git',
        '--skip-verification',
        '--dry-run',
        '--json',
        '--verbose',
      ]),
    );
    expect(args).not.toContain('--skip-publish');
    expect(args).not.toContain('--quiet');
  });

  it('should build release args with prerelease bump', () => {
    const args = buildReleaseArgs({
      config: undefined,
      projectDir: '.',
      bump: 'prerelease',
      prerelease: undefined,
      sync: 'false',
      branch: 'main',
      npmAuth: 'auto',
      skipNotes: 'false',
      skipPublish: 'false',
      skipGit: 'false',
      skipGithubRelease: 'false',
      skipVerification: 'false',
      dryRun: 'true',
      json: 'true',
      verbose: 'false',
      quiet: 'false',
    });

    expect(args).toEqual(
      expect.arrayContaining([
        'release',
        '--project-dir',
        '.',
        '--bump',
        'prerelease',
        '--branch',
        'main',
        '--npm-auth',
        'auto',
        '--dry-run',
        '--json',
      ]),
    );
    expect(args).not.toContain('--prerelease');
    expect(args).not.toContain('--sync');
    expect(args).not.toContain('--skip-notes');
    expect(args).not.toContain('--skip-publish');
    expect(args).not.toContain('--skip-git');
    expect(args).not.toContain('--skip-github-release');
    expect(args).not.toContain('--skip-verification');
    expect(args).not.toContain('--verbose');
    expect(args).not.toContain('--quiet');
  });

  it('should build preview args and honor dry-run fallback', () => {
    const args = buildPreviewArgs({
      config: 'releasekit.config.json',
      projectDir: '.',
      pr: '42',
      repo: 'owner/repo',
      previewPrerelease: 'true',
      previewStable: 'true',
      previewDryRun: 'false',
      dryRun: 'true',
      verbose: 'false',
    });

    expect(args).toEqual(
      expect.arrayContaining([
        'preview',
        '--config',
        'releasekit.config.json',
        '--project-dir',
        '.',
        '--pr',
        '42',
        '--repo',
        'owner/repo',
        '--prerelease',
        'true',
        '--stable',
        '--dry-run',
      ]),
    );
  });

  it('should build standing-pr publish args with --pr', () => {
    const args = buildStandingPRPublishArgs({
      config: 'releasekit.config.json',
      projectDir: '.',
      npmAuth: 'oidc',
      pr: '123',
    });

    expect(args).toEqual(
      expect.arrayContaining([
        'standing-pr',
        'publish',
        '--json',
        '--config',
        'releasekit.config.json',
        '--project-dir',
        '.',
        '--npm-auth',
        'oidc',
        '--pr',
        '123',
      ]),
    );
  });

  it('should omit --pr from standing-pr publish args when not provided', () => {
    const args = buildStandingPRPublishArgs({
      projectDir: '.',
    });

    expect(args).not.toContain('--pr');
    expect(args).toEqual(expect.arrayContaining(['standing-pr', 'publish', '--json']));
  });

  it('should build standing-pr update args with --reconcile when reconcile is true', () => {
    const args = buildStandingPRUpdateArgs({
      projectDir: '.',
      reconcile: 'true',
    });

    expect(args).toEqual(expect.arrayContaining(['standing-pr', 'update', '--json', '--reconcile']));
  });

  it('should omit --reconcile from standing-pr update args when reconcile is not set', () => {
    const args = buildStandingPRUpdateArgs({
      projectDir: '.',
    });

    expect(args).not.toContain('--reconcile');
    expect(args).toEqual(expect.arrayContaining(['standing-pr', 'update', '--json']));
  });

  it('should build refresh-after-release args', () => {
    const args = buildRefreshAfterReleaseArgs({ config: 'releasekit.config.json', projectDir: '.' });
    expect(args).toEqual(['refresh-after-release', '--config', 'releasekit.config.json', '--project-dir', '.']);
  });

  it('should accept refresh-after-release mode and run the cli with its args', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'releasekit-action-runner-test-'));
    tempDirs.push(tempDir);
    const cliPath = path.join(tempDir, 'fake-cli.mjs');
    fs.writeFileSync(cliPath, "console.log('ok')\n", 'utf-8');

    const result = await runAction(
      { mode: 'refresh-after-release', projectDir: '.', config: 'releasekit.config.json' },
      { cliPath },
    );

    expect(result.status).toBe(0);
    expect(result.args).toEqual(['refresh-after-release', '--config', 'releasekit.config.json', '--project-dir', '.']);
  });

  it('should parse INPUT_RECONCILE into the reconcile input', () => {
    const parsed = parseInputs({
      INPUT_MODE: 'standing-pr-update',
      INPUT_RECONCILE: 'true',
    });

    expect(parsed.reconcile).toBe('true');
  });

  it('should parse action env inputs', () => {
    const parsed = parseInputs({
      INPUT_MODE: 'preview',
      INPUT_PROJECT_DIR: 'repo',
      INPUT_DRY_RUN: 'true',
      INPUT_PREVIEW_DRY_RUN: 'true',
      INPUT_SKIP_GITHUB_RELEASE: 'true',
    });

    expect(parsed.mode).toBe('preview');
    expect(parsed.projectDir).toBe('repo');
    expect(parsed.dryRun).toBe('true');
    expect(parsed.previewDryRun).toBe('true');
    expect(parsed.skipGithubRelease).toBe('true');
  });

  it('should extract release JSON output when present', () => {
    const parsed = parseReleaseOutput('{"versionOutput":{"updates":[{"packageName":"a"}],"tags":["v1.0.0"]}}');
    expect(parsed?.versionOutput?.tags).toEqual(['v1.0.0']);
  });

  it('should return undefined for non-JSON release output', () => {
    expect(parseReleaseOutput('plain logs')).toBeUndefined();
  });

  it('should prefer parsed tags over the git fallback', () => {
    expect(resolveReleaseTags({ parsedTags: ['v1.2.3'], gitTags: ['v9.9.9'], allowRecovery: true })).toEqual({
      tags: ['v1.2.3'],
      recovered: false,
    });
  });

  it('should recover tags from git when recovery is allowed and parsed tags are empty', () => {
    expect(resolveReleaseTags({ parsedTags: [], gitTags: ['v1.2.3'], allowRecovery: true })).toEqual({
      tags: ['v1.2.3'],
      recovered: true,
    });
  });

  it('should treat missing parsed tags as empty and recover from git when allowed', () => {
    expect(resolveReleaseTags({ parsedTags: undefined, gitTags: ['v1.2.3'], allowRecovery: true })).toEqual({
      tags: ['v1.2.3'],
      recovered: true,
    });
  });

  it('should not recover from git when recovery is not allowed', () => {
    expect(resolveReleaseTags({ parsedTags: [], gitTags: ['v1.2.3'], allowRecovery: false })).toEqual({
      tags: [],
      recovered: false,
    });
  });

  it('should emit empty tags when neither source has any', () => {
    expect(resolveReleaseTags({ parsedTags: [], gitTags: [], allowRecovery: true })).toEqual({
      tags: [],
      recovered: false,
    });
  });

  it('should run cli with generated args', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'releasekit-action-runner-test-'));
    tempDirs.push(tempDir);
    const cliPath = path.join(tempDir, 'fake-cli.mjs');
    fs.writeFileSync(cliPath, "console.log('ok')\n", 'utf-8');

    const result = await runAction(
      {
        mode: 'release',
        projectDir: '.',
        npmAuth: 'auto',
        sync: 'false',
        dryRun: 'true',
      },
      { cliPath },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('ok');
    expect(result.args).toContain('--dry-run');
  });

  it('should resolve with non-zero status for a failing cli', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'releasekit-action-runner-test-'));
    tempDirs.push(tempDir);
    const cliPath = path.join(tempDir, 'fake-cli.mjs');
    fs.writeFileSync(cliPath, 'process.exit(1)\n', 'utf-8');

    const result = await runAction({ mode: 'release', projectDir: '.', npmAuth: 'auto' }, { cliPath });

    expect(result.status).toBe(1);
  });

  it('should build gate args with --json and --scope', () => {
    const args = buildGateArgs({
      config: 'releasekit.config.json',
      projectDir: '.',
      scope: 'electron',
      verbose: 'false',
      quiet: 'false',
    });

    expect(args).toEqual(
      expect.arrayContaining([
        'gate',
        '--json',
        '--config',
        'releasekit.config.json',
        '--project-dir',
        '.',
        '--scope',
        'electron',
      ]),
    );
  });

  it('should build backfill args for --all with release updates', () => {
    const args = buildBackfillArgs({
      config: 'releasekit.config.json',
      backfillAll: 'true',
      backfillUpdateReleases: 'true',
      backfillOnlyMissing: 'true',
      backfillApply: 'true',
    });

    expect(args).toEqual(
      expect.arrayContaining([
        'backfill',
        '--config',
        'releasekit.config.json',
        '--all',
        '--update-releases',
        '--only-missing',
        '--apply',
      ]),
    );
    // backfill resolves the project via the runner's cwd, not a CLI flag.
    expect(args).not.toContain('--project-dir');
  });

  it('should build single-package backfill args and omit unset flags', () => {
    const args = buildBackfillArgs({
      backfillPackage: '@scope/pkg',
      backfillPath: 'packages/pkg',
      backfillFrom: '1.1.0',
    });

    expect(args).toEqual(
      expect.arrayContaining(['backfill', '--package', '@scope/pkg', '--path', 'packages/pkg', '--from', '1.1.0']),
    );
    expect(args).not.toContain('--all');
    expect(args).not.toContain('--to');
    expect(args).not.toContain('--update-releases');
    expect(args).not.toContain('--only-missing');
    expect(args).not.toContain('--apply');
  });

  it('should accept backfill mode and map its inputs', () => {
    const parsed = parseInputs({
      INPUT_MODE: 'backfill',
      INPUT_PACKAGE: '@scope/pkg',
      INPUT_ALL: 'true',
      INPUT_FROM: '1.0.0',
      INPUT_UPDATE_RELEASES: 'true',
      INPUT_APPLY: 'true',
    });

    expect(parsed.mode).toBe('backfill');
    expect(parsed.backfillPackage).toBe('@scope/pkg');
    expect(parsed.backfillAll).toBe('true');
    expect(parsed.backfillFrom).toBe('1.0.0');
    expect(parsed.backfillUpdateReleases).toBe('true');
    expect(parsed.backfillApply).toBe('true');
  });

  it('should dispatch backfill mode to the backfill subcommand', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'releasekit-action-runner-test-'));
    tempDirs.push(tempDir);
    const cliPath = path.join(tempDir, 'fake-cli.mjs');
    fs.writeFileSync(cliPath, 'console.log(process.argv.slice(2).join(" "))\n', 'utf-8');

    const result = await runAction(
      { mode: 'backfill', projectDir: '.', backfillAll: 'true', backfillApply: 'true' },
      { cliPath },
    );

    expect(result.status).toBe(0);
    expect(result.args).toEqual(expect.arrayContaining(['backfill', '--all', '--apply']));
    expect(result.stdout).toContain('backfill --all --apply');
  });

  it('should parse gate outputs from JSON stdout', () => {
    const json = JSON.stringify({
      shouldRelease: true,
      bump: 'minor',
      scope: 'electron',
      labels: ['bump:minor'],
      prNumbers: [123],
    });

    const result: any = parseReleaseOutput(json);

    expect(result.shouldRelease).toBe(true);
    expect(result.bump).toBe('minor');
    expect(result.scope).toBe('electron');
  });
});

describe('buildReleaseSummary', () => {
  it('should generate failure banner when success is false', () => {
    const summary = buildReleaseSummary({ dryRun: 'false' }, undefined, false);
    expect(summary).toContain('Release Failed');
  });

  it('should generate dry-run banner when dry-run is true', () => {
    const summary = buildReleaseSummary({ dryRun: 'true' }, undefined, true);
    expect(summary).toContain('Dry Run');
  });

  it('should generate rocket header on successful release', () => {
    const summary = buildReleaseSummary({ dryRun: 'false' }, undefined, true);
    expect(summary).toContain('Release');
  });

  it('should show settings table when bump/target/scope provided', () => {
    const summary = buildReleaseSummary(
      { dryRun: 'false', bump: 'minor', target: '@scope/a', scope: 'shared' },
      undefined,
      true,
    );
    expect(summary).toContain('`minor`');
    expect(summary).toContain('`@scope/a`');
    expect(summary).toContain('`shared`');
  });

  it('should show package updates table from parsed output', () => {
    const parsed = {
      versionOutput: {
        updates: [
          { packageName: '@scope/a', newVersion: '1.1.0' },
          { packageName: '@scope/b', newVersion: '2.0.0' },
        ],
        tags: ['@scope/a@1.1.0', '@scope/b@2.0.0'],
      },
    };
    const summary = buildReleaseSummary({ dryRun: 'false' }, parsed, true);
    expect(summary).toContain('`@scope/a`');
    expect(summary).toContain('`1.1.0`');
    expect(summary).toContain('`@scope/b`');
    expect(summary).toContain('`2.0.0`');
    expect(summary).toContain('@scope/a@1.1.0');
  });

  it('should show no-changes message when no updates and not dry-run', () => {
    const summary = buildReleaseSummary({ dryRun: 'false' }, { versionOutput: { updates: [], tags: [] } }, true);
    expect(summary).toContain('No packages were updated');
  });
});

describe('buildGateSummary', () => {
  it('should generate gate check table with should-release true', () => {
    const summary = buildGateSummary(
      {},
      {
        shouldRelease: true,
        bump: 'minor',
        scope: 'electron',
        labels: ['bump:minor'],
        prNumbers: [123],
      },
      true,
    );
    expect(summary).toContain('Gate Check');
    expect(summary).toContain('Yes');
    expect(summary).toContain('`minor`');
    expect(summary).toContain('`electron`');
    expect(summary).toContain('`bump:minor`');
  });

  it('should show blocked message when blocked is true', () => {
    const summary = buildGateSummary(
      {},
      {
        shouldRelease: false,
        blocked: true,
        reason: 'Conflicting labels',
        labels: ['bump:major', 'bump:minor'],
        prNumbers: [123],
      },
      true,
    );
    expect(summary).toContain('Blocked');
    expect(summary).toContain('Conflicting labels');
  });

  it('should show reason message when should-release is false', () => {
    const summary = buildGateSummary(
      {},
      {
        shouldRelease: false,
        reason: 'No release labels found',
        labels: [],
        prNumbers: [123],
      },
      true,
    );
    expect(summary).toContain('No release labels found');
  });

  it('should show error banner when success is false', () => {
    const summary = buildGateSummary(
      {},
      {
        shouldRelease: false,
        reason: 'Configuration error',
        labels: [],
        prNumbers: [],
      },
      false,
    );
    expect(summary).toContain('Gate Failed');
    expect(summary).toContain('encountered an error');
  });
});
