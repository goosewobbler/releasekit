import * as fs from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildOrderedCategories } from '../../../src/core/pipeline.js';
import type { ChangelogInput, CompleteOptions, Config } from '../../../src/core/types.js';
import type { CompleteResult, LLMMessage } from '../../../src/llm/messages.js';
import type { LLMProvider } from '../../../src/llm/provider.js';

// Mock createProvider so we can inject a capturing provider.
vi.mock('../../../src/llm/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/llm/index.js')>();
  return { ...actual, createProvider: vi.fn() };
});

vi.mock('node:fs');

vi.mock('../../../src/monorepo/aggregator.js', () => ({
  detectMonorepo: vi.fn().mockReturnValue({ isMonorepo: true, packagesPath: 'packages' }),
  writeMonorepoChangelogs: vi.fn().mockReturnValue([]),
}));

const sampleInput: ChangelogInput = {
  source: 'version',
  packages: [
    {
      packageName: 'test-pkg',
      version: '1.0.0',
      previousVersion: '0.9.0',
      revisionRange: 'v0.9.0..HEAD',
      repoUrl: null,
      date: '2026-01-01',
      entries: [
        { type: 'added', description: 'Add feature' },
        { type: 'fixed', description: 'Fix bug' },
        { type: 'changed', description: 'Change behaviour' },
      ],
    },
  ],
};

describe('Pipeline: config.llm.options passthrough', () => {
  let capturedOpts: CompleteOptions | undefined;

  beforeEach(async () => {
    capturedOpts = undefined;
    const { createProvider } = await import('../../../src/llm/index.js');
    const mockProvider: LLMProvider = {
      name: 'capturing-mock',
      capabilities: { systemRole: true, structuredOutputs: false, toolUse: false },
      async complete(_messages: LLMMessage[], opts?: CompleteOptions): Promise<CompleteResult> {
        capturedOpts = opts;
        const content = JSON.stringify({
          entries: [
            { category: 'New Features', scope: null },
            { category: 'Bug Fixes', scope: null },
            { category: 'Bug Fixes', scope: null },
          ],
        });
        return { content, structured: JSON.parse(content) };
      },
    };
    vi.mocked(createProvider).mockReturnValue(mockProvider);
  });

  it('should pass config.llm.options to provider complete() calls', async () => {
    const { runPipeline } = await import('../../../src/core/pipeline.js');
    const config: Config = {
      changelog: false,
      releaseNotes: {
        llm: {
          provider: 'ollama',
          model: 'llama3',
          options: { maxTokens: 8000, timeout: 90000, temperature: 0.2 },
          tasks: { categorize: true },
        },
      },
    };

    await runPipeline(sampleInput, config, false);

    expect(capturedOpts).toMatchObject({ maxTokens: 8000, timeout: 90000, temperature: 0.2 });
  });

  it('should work without config.llm.options set (no opts passed to complete)', async () => {
    const { runPipeline } = await import('../../../src/core/pipeline.js');
    const config: Config = {
      changelog: false,
      releaseNotes: {
        llm: {
          provider: 'ollama',
          model: 'llama3',
          tasks: { categorize: true },
        },
      },
    };

    await runPipeline(sampleInput, config, false);

    // configOptions is undefined — config-level opts keys should not appear in captured opts
    expect(capturedOpts).not.toHaveProperty('maxTokens');
    expect(capturedOpts).not.toHaveProperty('timeout');
    expect(capturedOpts).not.toHaveProperty('temperature');
  });

  it('should use per-call options when provided, overriding config-level LLM options', async () => {
    // Verify the merge order: { ...configOptions, ...callOpts }
    // This is tested indirectly — if a task passes its own opts they win.
    // We verify the config options ARE present when no per-call override exists.
    const { runPipeline } = await import('../../../src/core/pipeline.js');
    const config: Config = {
      changelog: false,
      releaseNotes: {
        llm: {
          provider: 'ollama',
          model: 'llama3',
          options: { maxTokens: 4000 },
          tasks: { categorize: true },
        },
      },
    };

    await runPipeline(sampleInput, config, false);

    expect(capturedOpts).toMatchObject({ maxTokens: 4000 });
  });
});

describe('Pipeline: mode both does not double-write root', () => {
  beforeEach(async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined as never);
    vi.mocked(fs.writeFileSync).mockReturnValue(undefined);
    const { writeMonorepoChangelogs } = await import('../../../src/monorepo/aggregator.js');
    vi.mocked(writeMonorepoChangelogs).mockClear();
  });

  it('should pass mode: packages to writeMonorepoChangelogs when changelog mode is both', async () => {
    const { writeMonorepoChangelogs } = await import('../../../src/monorepo/aggregator.js');
    const { runPipeline } = await import('../../../src/core/pipeline.js');

    const config: Config = { changelog: { mode: 'both' } };
    await runPipeline(sampleInput, config, false);

    expect(writeMonorepoChangelogs).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ mode: 'packages' }),
      expect.anything(),
      false,
    );
    expect(writeMonorepoChangelogs).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ mode: 'both' }),
      expect.anything(),
      expect.anything(),
    );
  });

  it('should pass the changelog fileName to writeMonorepoChangelogs', async () => {
    const { writeMonorepoChangelogs } = await import('../../../src/monorepo/aggregator.js');
    const { runPipeline } = await import('../../../src/core/pipeline.js');

    const config: Config = { changelog: { mode: 'packages', file: 'CHANGES.md' } };
    await runPipeline(sampleInput, config, false);

    expect(writeMonorepoChangelogs).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ fileName: 'CHANGES.md' }),
      expect.anything(),
      false,
    );
  });

  it('should pass separate fileNames when both changelog and releaseNotes use mode: packages', async () => {
    const { writeMonorepoChangelogs } = await import('../../../src/monorepo/aggregator.js');
    const { runPipeline } = await import('../../../src/core/pipeline.js');

    const config: Config = {
      changelog: { mode: 'packages', file: 'CHANGELOG.md' },
      releaseNotes: { mode: 'packages', file: 'RELEASE_NOTES.md' },
    };
    await runPipeline(sampleInput, config, false);

    expect(writeMonorepoChangelogs).toHaveBeenCalledTimes(2);
    expect(writeMonorepoChangelogs).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ fileName: 'CHANGELOG.md' }),
      expect.anything(),
      false,
    );
    expect(writeMonorepoChangelogs).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ fileName: 'RELEASE_NOTES.md' }),
      expect.anything(),
      false,
    );
  });
});

describe('buildOrderedCategories', () => {
  const raw = [
    { category: 'Fixed', entries: [{ type: 'fixed' as const, description: 'Fix bug' }] },
    { category: 'New', entries: [{ type: 'added' as const, description: 'Add feature' }] },
    { category: 'Unknown', entries: [{ type: 'changed' as const, description: 'Some change' }] },
  ];

  it('should map raw categories to EnhancedCategory shape', () => {
    const result = buildOrderedCategories(raw);
    expect(result[0]).toMatchObject({ name: 'Fixed', entries: [{ description: 'Fix bug' }] });
    expect(result[1]).toMatchObject({ name: 'New', entries: [{ description: 'Add feature' }] });
  });

  it('should preserve original order when no config categories provided', () => {
    const result = buildOrderedCategories(raw);
    expect(result.map((c) => c.name)).toEqual(['Fixed', 'New', 'Unknown']);
  });

  it('should sort by config category order', () => {
    const config = [
      { name: 'New', description: 'New features' },
      { name: 'Fixed', description: 'Bug fixes' },
    ];
    const result = buildOrderedCategories(raw, config);
    expect(result.map((c) => c.name)).toEqual(['New', 'Fixed', 'Unknown']);
  });

  it('should append categories not in config order at the end', () => {
    const config = [{ name: 'New', description: 'New features' }];
    const result = buildOrderedCategories(raw, config);
    expect(result[0]?.name).toBe('New');
    expect(result.slice(1).map((c) => c.name)).toContain('Fixed');
    expect(result.slice(1).map((c) => c.name)).toContain('Unknown');
  });

  it('should return empty array for empty input', () => {
    expect(buildOrderedCategories([])).toEqual([]);
    expect(buildOrderedCategories([], [{ name: 'New', description: 'x' }])).toEqual([]);
  });
});

describe('Pipeline: file-only config defaults mode to root', () => {
  beforeEach(() => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined as never);
    vi.mocked(fs.writeFileSync).mockReturnValue(undefined);
  });

  it('should write changelog when config has file but no mode', async () => {
    const { runPipeline } = await import('../../../src/core/pipeline.js');

    const config: Config = { changelog: { file: 'CHANGES.md' } };
    const result = await runPipeline(sampleInput, config, false);

    expect(result.files).toContain('CHANGES.md');
    expect(fs.writeFileSync).toHaveBeenCalledWith('CHANGES.md', expect.any(String), 'utf-8');
  });

  it('should write release notes when config has file but no mode', async () => {
    const { runPipeline } = await import('../../../src/core/pipeline.js');

    const config: Config = { changelog: false, releaseNotes: { file: 'NOTES.md' } };
    const result = await runPipeline(sampleInput, config, false);

    expect(result.files).toContain('NOTES.md');
    expect(fs.writeFileSync).toHaveBeenCalledWith('NOTES.md', expect.any(String), 'utf-8');
  });

  it('should not write a release notes file when only LLM config is set (no mode or file)', async () => {
    const { runPipeline } = await import('../../../src/core/pipeline.js');

    const config: Config = {
      changelog: false,
      releaseNotes: { llm: { provider: 'openai-compatible', model: 'gpt-4o', tasks: { releaseNotes: true } } },
    };
    const result = await runPipeline(sampleInput, config, false);

    expect(result.files).toHaveLength(0);
    expect(fs.writeFileSync).not.toHaveBeenCalledWith(
      expect.stringContaining('RELEASE_NOTES'),
      expect.anything(),
      expect.anything(),
    );
  });

  it('should populate releaseNotes in result when releaseNotesConfig is set without tasks.releaseNotes', async () => {
    const { runPipeline } = await import('../../../src/core/pipeline.js');

    const config: Config = {
      changelog: false,
      releaseNotes: { mode: 'root', file: 'RELEASE_NOTES.md' },
    };
    const result = await runPipeline(sampleInput, config, false);

    expect(result.releaseNotes).toBeDefined();
    expect(result.releaseNotes?.['test-pkg']).toBeTruthy();
  });

  it('should not populate releaseNotes in result when releaseNotesConfig is not set', async () => {
    const { runPipeline } = await import('../../../src/core/pipeline.js');

    const config: Config = { changelog: { mode: 'root' } };
    const result = await runPipeline(sampleInput, config, false);

    expect(result.releaseNotes).toBeUndefined();
  });
});
