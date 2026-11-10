import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { VersionOutput } from '@releasekit/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runRelease } from '../../src/release.js';
import type { ReleaseOptions } from '../../src/types.js';

const versionOutput: VersionOutput = {
  dryRun: true,
  updates: [{ packageName: 'test-pkg', newVersion: '1.1.0', filePath: 'package.json' }],
  changelogs: [
    {
      packageName: 'test-pkg',
      version: '1.1.0',
      previousVersion: '1.0.0',
      revisionRange: 'v1.0.0..HEAD',
      repoUrl: null,
      entries: [{ type: 'added', description: 'New feature' }],
    },
  ],
  tags: ['v1.1.0'],
};

vi.mock('@releasekit/version', () => ({
  enableJsonOutput: vi.fn(),
  flushPendingWrites: vi.fn(() => []),
  getJsonData: () => structuredClone(versionOutput),
  loadConfig: vi.fn(() => ({})),
  VersionEngine: vi.fn(function (this: Record<string, unknown>) {
    this.getWorkspacePackages = async () => ({ packages: [{ packageJson: { name: 'test-pkg' } }] });
    this.setStrategy = vi.fn();
    this.run = vi.fn();
  }),
}));

const mockPublishRunPipeline = vi.fn();

vi.mock('@releasekit/publish', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@releasekit/publish')>();
  return {
    PipelineError: actual.PipelineError,
    runPipeline: (...args: unknown[]) => mockPublishRunPipeline(...args),
    loadConfig: () => ({ git: {} }),
  };
});

// Loads the real notes pipeline, whose first import can exceed the 5s default under a full turbo run.
describe('runRelease with llm.model from an unset {env:} variable', { timeout: 15_000 }, () => {
  let projectDir: string;
  let options: ReleaseOptions;

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'releasekit-release-llm-model-'));
    fs.writeFileSync(
      path.join(projectDir, 'releasekit.config.json'),
      JSON.stringify({
        notes: {
          changelog: false,
          releaseNotes: { llm: { provider: 'ollama', model: '{env:OLLAMA_MODEL}', tasks: { releaseNotes: true } } },
        },
      }),
    );
    vi.stubEnv('OLLAMA_MODEL', undefined);
    // No GitHub context, so the run reads no PR labels.
    vi.stubEnv('GITHUB_REPOSITORY', undefined);
    mockPublishRunPipeline.mockReset().mockResolvedValue({ dryRun: true, git: {} });
    options = {
      dryRun: true,
      sync: false,
      skipNotes: false,
      skipPublish: false,
      skipGit: false,
      skipGithubRelease: false,
      skipVerification: false,
      json: false,
      verbose: false,
      quiet: true,
      projectDir,
    };
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it('should load and publish when notes are skipped', async () => {
    const result = await runRelease({ ...options, skipNotes: true });

    expect(result?.notesGenerated).toBe(false);
    expect(mockPublishRunPipeline).toHaveBeenCalledOnce();
  });

  it('should fail the notes step naming the field and the unset variable', async () => {
    await expect(runRelease(options)).rejects.toThrow('notes.releaseNotes.llm.model: {env:OLLAMA_MODEL} is not set');
    expect(mockPublishRunPipeline).not.toHaveBeenCalled();
  });

  it('should fail before writing the version bumps', async () => {
    const { flushPendingWrites } = await import('@releasekit/version');

    await expect(runRelease({ ...options, dryRun: false })).rejects.toThrow(
      'notes.releaseNotes.llm.model: {env:OLLAMA_MODEL} is not set',
    );
    expect(flushPendingWrites).not.toHaveBeenCalled();
  });
});
