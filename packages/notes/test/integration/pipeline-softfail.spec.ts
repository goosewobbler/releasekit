import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runPipeline } from '../../src/core/pipeline.js';
import type { ChangelogInput, Config } from '../../src/core/types.js';

const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));

vi.mock('openai', () => ({
  default: class MockOpenAI {
    chat = { completions: { create: createMock } };
  },
}));

// No repoUrl → the pipeline skips example and PR-context fetches (no network).
const input: ChangelogInput = {
  source: 'version',
  packages: [
    {
      packageName: 'my-lib',
      version: '2.0.0',
      previousVersion: 'v1.0.0',
      revisionRange: 'v1.0.0..HEAD',
      date: '2026-01-15',
      entries: [
        { type: 'added', description: 'raw one' },
        { type: 'fixed', description: 'raw two' },
        { type: 'changed', description: 'raw three' },
      ],
    },
  ],
};

const config: Config = {
  changelog: false,
  releaseNotes: {
    llm: {
      provider: 'openai',
      model: 'gpt-test',
      apiKey: 'k',
      retry: { maxAttempts: 1, initialDelay: 0 },
      tasks: { enhance: true, categorize: true, summarize: true },
    },
  },
};

const enhancedPayload = JSON.stringify({
  entries: [
    { description: 'ENHANCED one', category: 'New', scope: null, breaking: null, leadIn: null },
    { description: 'ENHANCED two', category: 'Fixed', scope: null, breaking: null, leadIn: null },
    { description: 'ENHANCED three', category: 'Changed', scope: null, breaking: null, leadIn: null },
  ],
});

describe('Pipeline: per-task soft-fail', () => {
  beforeEach(() => {
    createMock.mockReset();
  });

  it('should keep enhance+categorize output when a later summarize task fails', async () => {
    createMock.mockImplementation((params: { response_format?: unknown }) => {
      // enhance+categorize uses the structured-output (response_format) path; summarize is plain text.
      if (params.response_format) {
        return Promise.resolve({ choices: [{ message: { content: enhancedPayload } }] });
      }
      return Promise.reject(Object.assign(new Error('summarize boom'), { status: 400 }));
    });

    const result = await runPipeline(input, config, false);

    // Old behavior discarded the whole enhancement on a late failure and re-rendered the raw entries.
    const notes = result.packageNotes['my-lib'] ?? '';
    expect(notes).toContain('ENHANCED');
    expect(notes).not.toContain('raw one');
  });
});
