import * as fs from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChangelogInput, CompleteOptions, Config } from '../../src/core/types.js';
import type { CompleteResult, LLMMessage } from '../../src/llm/messages.js';
import type { LLMProvider } from '../../src/llm/provider.js';

vi.mock('../../src/llm/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/llm/index.js')>();
  return { ...actual, createProvider: vi.fn() };
});

vi.mock('node:fs');

vi.mock('../../src/monorepo/aggregator.js', () => ({
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
    const { createProvider } = await import('../../src/llm/index.js');
    const mockProvider: LLMProvider = {
      name: 'capturing-mock',
      capabilities: { systemRole: true, structuredOutputs: false, toolUse: false },
      async complete(_messages: LLMMessage[], opts?: CompleteOptions): Promise<CompleteResult> {
        capturedOpts = opts;
        const content = JSON.stringify({
          entries: [
            { index: 0, category: 'New Features', scope: null },
            { index: 1, category: 'Bug Fixes', scope: null },
            { index: 2, category: 'Bug Fixes', scope: null },
          ],
        });
        return { content, structured: JSON.parse(content) };
      },
    };
    vi.mocked(createProvider).mockReturnValue(mockProvider);
  });

  it('should pass config.llm.options to provider complete() calls', async () => {
    const { runPipeline } = await import('../../src/core/pipeline.js');
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
    const { runPipeline } = await import('../../src/core/pipeline.js');
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

    expect(capturedOpts).not.toHaveProperty('maxTokens');
    expect(capturedOpts).not.toHaveProperty('timeout');
    expect(capturedOpts).not.toHaveProperty('temperature');
  });

  it('should use per-call options when provided, overriding config-level LLM options', async () => {
    const { runPipeline } = await import('../../src/core/pipeline.js');
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

describe('Pipeline: per-package changelogs', () => {
  beforeEach(async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined as never);
    vi.mocked(fs.writeFileSync).mockReturnValue(undefined);
    const { writeMonorepoChangelogs } = await import('../../src/monorepo/aggregator.js');
    vi.mocked(writeMonorepoChangelogs).mockClear();
  });

  it('should pass the changelog fileName to writeMonorepoChangelogs', async () => {
    const { writeMonorepoChangelogs } = await import('../../src/monorepo/aggregator.js');
    const { runPipeline } = await import('../../src/core/pipeline.js');

    const config: Config = { changelog: { mode: 'packages', file: 'CHANGES.md' } };
    await runPipeline(sampleInput, config, false);

    expect(writeMonorepoChangelogs).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ fileName: 'CHANGES.md' }),
      expect.any(Function),
      false,
    );
  });

  it('should route only the changelog through writeMonorepoChangelogs (release notes use per-version files)', async () => {
    const { writeMonorepoChangelogs } = await import('../../src/monorepo/aggregator.js');
    const { runPipeline } = await import('../../src/core/pipeline.js');

    const config: Config = {
      changelog: { mode: 'packages', file: 'CHANGELOG.md' },
      releaseNotes: { file: { dir: 'release-notes' } },
    };
    await runPipeline(sampleInput, config, false);

    expect(writeMonorepoChangelogs).toHaveBeenCalledTimes(1);
    expect(writeMonorepoChangelogs).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ fileName: 'CHANGELOG.md' }),
      expect.any(Function),
      false,
    );
  });

  it('should render per-package changelogs with the configured refs mode', async () => {
    const { writeMonorepoChangelogs } = await import('../../src/monorepo/aggregator.js');
    const { runPipeline, createTemplateContext } = await import('../../src/core/pipeline.js');

    const config: Config = { changelog: { mode: 'packages', refs: 'strip' } };
    await runPipeline(sampleInput, config, false);

    const render = vi.mocked(writeMonorepoChangelogs).mock.calls[0]?.[2];
    const pkg = sampleInput.packages[0];
    if (!render || !pkg) {
      throw new Error('expected a per-package render');
    }
    const withRef = createTemplateContext({
      ...pkg,
      repoUrl: 'https://github.com/acme/repo',
      entries: [{ type: 'fixed', description: 'Fix bug', issueIds: ['#12'] }],
    });
    expect(render([withRef])).not.toContain('#12');
  });
});

describe('Pipeline: changelog file default + release-notes summary', () => {
  beforeEach(() => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined as never);
    vi.mocked(fs.writeFileSync).mockReturnValue(undefined);
  });

  it('should write changelog when config has file but no mode', async () => {
    const { runPipeline } = await import('../../src/core/pipeline.js');

    const config: Config = { changelog: { file: 'CHANGES.md' } };
    const result = await runPipeline(sampleInput, config, false);

    expect(result.files).toContain('CHANGES.md');
    expect(fs.writeFileSync).toHaveBeenCalledWith('CHANGES.md', expect.any(String), 'utf-8');
  });

  it('should not write a release notes file when only LLM config is set (no file output)', async () => {
    const { runPipeline } = await import('../../src/core/pipeline.js');

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
    const { runPipeline } = await import('../../src/core/pipeline.js');

    // releaseNotes set (even with no file output) → notes are resolved for the GitHub release body.
    const config: Config = {
      changelog: false,
      releaseNotes: {},
    };
    const result = await runPipeline(sampleInput, config, false);

    expect(result.releaseNotes).toBeDefined();
    expect(result.releaseNotes?.['test-pkg']).toBeTruthy();
  });

  it('should not populate releaseNotes in result when releaseNotesConfig is not set', async () => {
    const { runPipeline } = await import('../../src/core/pipeline.js');

    const config: Config = { changelog: { mode: 'root' } };
    const result = await runPipeline(sampleInput, config, false);

    expect(result.releaseNotes).toBeUndefined();
  });
});

describe('Pipeline: skipReleaseNotes / skipChangelogs flags', () => {
  beforeEach(() => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined as never);
    vi.mocked(fs.writeFileSync).mockReturnValue(undefined);
  });

  it('should not write release-notes files and should not invoke the LLM when skipReleaseNotes:true', async () => {
    const { createProvider } = await import('../../src/llm/index.js');
    vi.mocked(createProvider).mockClear();

    const { runPipeline } = await import('../../src/core/pipeline.js');
    const config: Config = {
      changelog: { mode: 'root', file: 'CHANGELOG.md' },
      releaseNotes: {
        file: { dir: 'release-notes' },
        llm: { provider: 'openai-compatible', model: 'gpt-4o', tasks: { releaseNotes: true } },
      },
    };
    const result = await runPipeline(sampleInput, config, false, { skipReleaseNotes: true });

    expect(createProvider).not.toHaveBeenCalled();
    expect(result.files).toContain('CHANGELOG.md');
    expect(result.files.some((f) => f.includes('release-notes'))).toBe(false);
    expect(result.releaseNotes).toBeUndefined();
  });

  it('should skip CHANGELOG.md but still write release-notes files when skipChangelogs:true', async () => {
    const { createProvider } = await import('../../src/llm/index.js');
    vi.mocked(createProvider).mockClear();

    const { runPipeline } = await import('../../src/core/pipeline.js');
    const config: Config = {
      changelog: { mode: 'root', file: 'CHANGELOG.md' },
      releaseNotes: { file: { dir: 'release-notes' } },
    };
    const result = await runPipeline(sampleInput, config, false, { skipChangelogs: true });

    expect(result.files).not.toContain('CHANGELOG.md');
    expect(result.files).toContain('release-notes/test-pkg/1.0.0.md');
  });

  it('should write release notes only for releaseNotesFor, laid out for the whole release', async () => {
    const { detectMonorepo } = await import('../../src/monorepo/aggregator.js');
    vi.mocked(detectMonorepo).mockReturnValueOnce({ isMonorepo: false, packagesPath: 'packages' });

    const { runPipeline } = await import('../../src/core/pipeline.js');
    const config: Config = {
      changelog: { mode: 'root', file: 'CHANGELOG.md' },
      releaseNotes: { file: { dir: 'release-notes' } },
    };
    const packages = sampleInput.packages;
    const input: ChangelogInput = {
      ...sampleInput,
      packages: [...packages, ...packages.map((pkg) => ({ ...pkg, packageName: 'other-pkg' }))],
    };
    const result = await runPipeline(input, config, false, { releaseNotesFor: ['other-pkg'] });

    expect(result.files).toEqual(['release-notes/other-pkg/1.0.0.md']);
    expect(Object.keys(result.releaseNotes ?? {})).toEqual(['other-pkg']);
  });

  it('should return release notes but write no release-notes file when skipReleaseNotesFiles:true', async () => {
    vi.mocked(fs.writeFileSync).mockClear();
    const { runPipeline } = await import('../../src/core/pipeline.js');
    const config: Config = {
      changelog: { mode: 'root', file: 'CHANGELOG.md' },
      releaseNotes: { file: { dir: 'release-notes' } },
    };

    const result = await runPipeline(sampleInput, config, false, {
      releaseNotesFor: ['test-pkg'],
      skipReleaseNotesFiles: true,
    });

    expect(result.files).toEqual([]);
    expect(fs.writeFileSync).not.toHaveBeenCalled();
    expect(Object.keys(result.releaseNotes ?? {})).toEqual(['test-pkg']);
  });

  it('should preserve existing behaviour with both flags omitted (changelog + release notes both written)', async () => {
    const { runPipeline } = await import('../../src/core/pipeline.js');
    const config: Config = {
      changelog: { mode: 'root', file: 'CHANGELOG.md' },
      releaseNotes: { file: { dir: 'release-notes' } },
    };
    const result = await runPipeline(sampleInput, config, false);

    expect(result.files).toContain('CHANGELOG.md');
    expect(result.files).toContain('release-notes/test-pkg/1.0.0.md');
  });
});

describe('Pipeline: versioned release notes file output', () => {
  beforeEach(() => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined as never);
    vi.mocked(fs.writeFileSync).mockReturnValue(undefined);
  });

  it('should nest per-version files by package in a monorepo (detectMonorepo → true)', async () => {
    const { runPipeline } = await import('../../src/core/pipeline.js');

    // detectMonorepo is mocked to isMonorepo: true at the top of this file, so even this
    // single-package run nests by package.
    const config: Config = { changelog: false, releaseNotes: { file: { dir: 'release-notes' } } };
    const result = await runPipeline(sampleInput, config, false);

    expect(result.files).toContain('release-notes/test-pkg/1.0.0.md');
    const call = vi.mocked(fs.writeFileSync).mock.calls.find(([p]) => p === 'release-notes/test-pkg/1.0.0.md') as
      | [string, string]
      | undefined;
    expect(call?.[1]).not.toContain('# Changelog');
  });

  it('should write a flat per-version file in a single-package repo (detectMonorepo → false)', async () => {
    const { runPipeline } = await import('../../src/core/pipeline.js');
    const { detectMonorepo } = await import('../../src/monorepo/aggregator.js');
    vi.mocked(detectMonorepo).mockReturnValueOnce({ isMonorepo: false, packagesPath: '' });

    const config: Config = { changelog: false, releaseNotes: { file: { dir: 'release-notes' } } };
    const result = await runPipeline(sampleInput, config, false);

    expect(result.files).toContain('release-notes/1.0.0.md');
  });

  it('should honor a custom directory', async () => {
    const { runPipeline } = await import('../../src/core/pipeline.js');

    const config: Config = { changelog: false, releaseNotes: { file: { dir: 'docs/releases' } } };
    const result = await runPipeline(sampleInput, config, false);

    expect(result.files).toContain('docs/releases/test-pkg/1.0.0.md');
  });

  it('should not write any release-notes file when file output is not configured', async () => {
    const { runPipeline } = await import('../../src/core/pipeline.js');

    const config: Config = { changelog: false, releaseNotes: { links: { title: 'Links' } } };
    const result = await runPipeline(sampleInput, config, false);

    expect(result.files).toHaveLength(0);
  });
});
