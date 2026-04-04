import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildPreviewArgs,
  buildReleaseArgs,
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
      target: '@scope/a,@scope/b',
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
        '--target',
        '@scope/a,@scope/b',
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

  it('should run cli with generated args', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'releasekit-action-runner-test-'));
    tempDirs.push(tempDir);
    const cliPath = path.join(tempDir, 'fake-cli.mjs');
    fs.writeFileSync(cliPath, "console.log('ok')\n", 'utf-8');

    const result = runAction(
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
});
