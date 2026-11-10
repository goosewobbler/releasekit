import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNotesCommand } from '../../src/command.js';
import { loadConfig } from '../../src/core/config.js';
import { runPipeline } from '../../src/core/pipeline.js';
import type { ChangelogInput, Config } from '../../src/core/types.js';

// No repoUrl, so the pipeline fetches no examples or PR context.
const input: ChangelogInput = {
  source: 'version',
  packages: [
    {
      packageName: 'my-lib',
      version: '2.0.0',
      previousVersion: 'v1.0.0',
      revisionRange: 'v1.0.0..HEAD',
      repoUrl: null,
      date: '2026-01-15',
      entries: [{ type: 'added', description: 'Add streaming support' }],
    },
  ],
};

describe('Pipeline: llm.model is checked only when LLM tasks run', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'releasekit-llm-model-'));
    vi.stubEnv('OLLAMA_MODEL', undefined);
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  function loadWithLlm(llm: Record<string, unknown>): Config {
    fs.writeFileSync(
      path.join(dir, 'releasekit.config.json'),
      JSON.stringify({ notes: { changelog: false, releaseNotes: { llm: { provider: 'ollama', ...llm } } } }),
    );
    return loadConfig(dir);
  }

  it.each([
    ['changelog enhancement', { enhance: true }],
    ['release notes', { releaseNotes: true }],
  ])('should name the unset {env:} variable before running %s', async (_task, tasks) => {
    const config = loadWithLlm({ model: '{env:OLLAMA_MODEL}', tasks });

    await expect(runPipeline(input, config, false)).rejects.toThrow(
      'notes.releaseNotes.llm.model: {env:OLLAMA_MODEL} is not set',
    );
  });

  it('should name the field when no model is configured', async () => {
    const config = loadWithLlm({ tasks: { enhance: true } });

    await expect(runPipeline(input, config, false)).rejects.toThrow(
      'notes.releaseNotes.llm.model: required to run LLM tasks',
    );
  });

  it('should run without a model when no LLM task is on', async () => {
    const config = loadWithLlm({ model: '{env:OLLAMA_MODEL}', tasks: { enhance: false } });

    await expect(runPipeline(input, config, false)).resolves.toMatchObject({
      packageNotes: { 'my-lib': expect.stringContaining('Add streaming support') },
    });
  });

  it('should name the unset {env:} variable when --llm-* flags override the config', async () => {
    loadWithLlm({ model: '{env:OLLAMA_MODEL}' });
    const inputFile = path.join(dir, 'version.json');
    fs.writeFileSync(
      inputFile,
      JSON.stringify({ dryRun: true, updates: [], tags: [], changelogs: [{ ...input.packages[0], version: '2.0.0' }] }),
    );
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`exit ${code}`);
    });
    vi.spyOn(process, 'cwd').mockReturnValue(dir);

    await expect(
      createNotesCommand().parseAsync(['node', 'test', 'generate', '-i', inputFile, '--llm-tasks', 'enhance']),
    ).rejects.toThrow('exit');
    expect(errors.mock.calls.flat().join('\n')).toContain(
      'notes.releaseNotes.llm.model: {env:OLLAMA_MODEL} is not set',
    );
  });

  it('should run without a model when release notes are skipped', async () => {
    const config = loadWithLlm({ model: '{env:OLLAMA_MODEL}', tasks: { enhance: true, releaseNotes: true } });

    await expect(runPipeline(input, config, false, { skipReleaseNotes: true })).resolves.toMatchObject({
      packageNotes: { 'my-lib': expect.stringContaining('Add streaming support') },
    });
  });
});
