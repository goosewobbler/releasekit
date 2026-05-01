import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildGateArgs,
  buildGateSummary,
  buildPreviewArgs,
  buildReleaseArgs,
  buildReleaseSummary,
  parseInputs,
  parseReleaseOutput,
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
