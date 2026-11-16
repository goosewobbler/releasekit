import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChangelogInput, Config } from '../../src/core/types.js';
import type { CompleteResult } from '../../src/llm/messages.js';
import type { LLMProvider } from '../../src/llm/provider.js';

vi.mock('../../src/llm/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/llm/index.js')>();
  return { ...actual, createProvider: vi.fn() };
});

const input: ChangelogInput = {
  source: 'version',
  packages: [
    {
      packageName: 'my-lib',
      version: '2.0.0',
      previousVersion: '1.0.0',
      revisionRange: 'v1.0.0..HEAD',
      repoUrl: null,
      date: '2026-01-15',
      entries: [
        { type: 'added', description: 'Add streaming support' },
        { type: 'fixed', description: 'Fix null pointer' },
      ],
    },
  ],
};

const CATEGORIZED = JSON.stringify({
  entries: [
    { category: 'Highlights', scope: null },
    { category: 'Highlights', scope: null },
  ],
});

describe('Pipeline: plainChangelog', () => {
  let dir: string;
  let config: Config;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'releasekit-plain-changelog-'));
    config = {
      changelog: { mode: 'root', file: path.join(dir, 'CHANGELOG.md') },
      releaseNotes: { llm: { provider: 'mock', model: 'mock', tasks: { categorize: true }, examples: 0 } },
    };
    const { createProvider } = await import('../../src/llm/index.js');
    const provider: LLMProvider = {
      name: 'mock',
      capabilities: { systemRole: true, structuredOutputs: false, toolUse: false },
      async complete(): Promise<CompleteResult> {
        return { content: CATEGORIZED, structured: JSON.parse(CATEGORIZED) };
      },
    };
    vi.mocked(createProvider).mockReturnValue(provider);
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('should write the changelog without the LLM categories while the release notes keep them', async () => {
    const { runPipeline } = await import('../../src/core/pipeline.js');

    const result = await runPipeline(input, config, false, { plainChangelog: true });

    const changelog = fs.readFileSync(path.join(dir, 'CHANGELOG.md'), 'utf-8');
    expect(changelog).toContain('### Added\n\n- Add streaming support');
    expect(changelog).toContain('### Fixed\n\n- Fix null pointer');
    expect(changelog).not.toContain('Highlights');
    expect(result.releaseNotes?.['my-lib']).toContain('### Highlights');
  });

  it('should write the LLM categories to the changelog without the option', async () => {
    const { runPipeline } = await import('../../src/core/pipeline.js');

    await runPipeline(input, config, false);

    expect(fs.readFileSync(path.join(dir, 'CHANGELOG.md'), 'utf-8')).toContain('### Highlights');
  });
});
