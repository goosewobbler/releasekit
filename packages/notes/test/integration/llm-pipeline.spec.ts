import { describe, expect, it } from 'vitest';
import { runPipeline } from '../../src/core/pipeline.js';
import type { ChangelogInput, Config } from '../../src/core/types.js';
import type { LLMProvider } from '../../src/llm/provider.js';
import { categorizeEntries } from '../../src/llm/tasks/categorize.js';
import { enhanceEntries } from '../../src/llm/tasks/enhance.js';
import { generateReleaseNotes } from '../../src/llm/tasks/release-notes.js';
import { summarizeEntries } from '../../src/llm/tasks/summarize.js';

// ---------------------------------------------------------------------------
// Mock provider factory
// ---------------------------------------------------------------------------

function makeMockProvider(response = 'Enhanced description'): LLMProvider & { callCount: number } {
  let callCount = 0;
  return {
    name: 'mock',
    get callCount() {
      return callCount;
    },
    async complete(): Promise<string> {
      callCount++;
      return response;
    },
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const sampleInput: ChangelogInput = {
  source: 'package-versioner',
  packages: [
    {
      packageName: 'my-lib',
      version: '2.0.0',
      previousVersion: 'v1.0.0',
      revisionRange: 'v1.0.0..HEAD',
      repoUrl: 'https://github.com/acme/my-lib',
      date: '2026-01-15',
      entries: [
        { type: 'added', description: 'Add streaming support' },
        { type: 'fixed', description: 'Fix null pointer' },
        { type: 'changed', description: 'Refactor config loading' },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// Dry-run skips LLM
// ---------------------------------------------------------------------------

describe('Pipeline: dry-run skips LLM', () => {
  it('does not throw even when LLM provider is misconfigured', async () => {
    // If dry-run skips LLM, a nonexistent provider should not cause a failure.
    const config: Config = {
      output: [{ format: 'markdown', file: '/dev/null' }],
      llm: { provider: 'nonexistent-provider', model: 'any', tasks: { enhance: true } },
    };

    await expect(runPipeline(sampleInput, config, true)).resolves.not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// LLM enhance task with a mock provider (direct task tests)
// ---------------------------------------------------------------------------

describe('LLM tasks: enhance', () => {
  it('replaces entry descriptions with provider responses', async () => {
    const provider = makeMockProvider('Polished description');
    const result = await enhanceEntries(provider, sampleInput.packages[0]?.entries, {
      packageName: 'my-lib',
      version: '2.0.0',
    });

    expect(result).toHaveLength(3);
    expect(result.every((e) => e.description === 'Polished description')).toBe(true);
    expect(provider.callCount).toBe(3);
  });

  it('preserves original entry when provider fails', async () => {
    const provider: LLMProvider = {
      name: 'failing',
      async complete(): Promise<string> {
        throw new Error('API down');
      },
    };

    const result = await enhanceEntries(provider, sampleInput.packages[0]?.entries, {});
    expect(result[0]?.description).toBe('Add streaming support');
    expect(result[1]?.description).toBe('Fix null pointer');
  });

  it('respects the concurrency parameter', async () => {
    const _callOrder: number[] = [];
    let activeCount = 0;
    let maxActive = 0;

    const trackingProvider: LLMProvider = {
      name: 'tracking',
      async complete(): Promise<string> {
        activeCount++;
        maxActive = Math.max(maxActive, activeCount);
        await new Promise((r) => setTimeout(r, 10));
        activeCount--;
        return 'done';
      },
    };

    const manyEntries = Array.from({ length: 10 }, (_, i) => ({
      type: 'added' as const,
      description: `Entry ${i}`,
    }));

    await enhanceEntries(trackingProvider, manyEntries, {}, 3);
    // With concurrency=3, no more than 3 calls should be in flight at once
    expect(maxActive).toBeLessThanOrEqual(3);
  });
});

describe('LLM tasks: summarize', () => {
  it('returns the summary from the provider', async () => {
    const provider = makeMockProvider('This release brings streaming and fixes.');
    const summary = await summarizeEntries(provider, sampleInput.packages[0]?.entries, {
      packageName: 'my-lib',
      version: '2.0.0',
    });
    expect(summary).toBe('This release brings streaming and fixes.');
    expect(provider.callCount).toBe(1);
  });
});

describe('LLM tasks: categorize', () => {
  it('groups entries by category from JSON response', async () => {
    const entries = sampleInput.packages[0]?.entries;
    const jsonResponse = JSON.stringify({ Features: [0], Fixes: [1], Maintenance: [2] });
    const provider = makeMockProvider(jsonResponse);

    const result = await categorizeEntries(provider, entries, { packageName: 'my-lib' });

    expect(result.find((c) => c.category === 'Features')?.entries[0]?.description).toBe('Add streaming support');
    expect(result.find((c) => c.category === 'Fixes')?.entries[0]?.description).toBe('Fix null pointer');
  });

  it('falls back to General on invalid JSON and does not throw', async () => {
    const provider = makeMockProvider('not json');
    const result = await categorizeEntries(provider, sampleInput.packages[0]?.entries, {});
    expect(result[0]?.category).toBe('General');
    expect(result[0]?.entries).toHaveLength(3);
  });
});

describe('LLM tasks: release notes', () => {
  it('returns release notes from the provider', async () => {
    const notes = '## v2.0.0\n\nThis release adds streaming and fixes a null pointer.';
    const provider = makeMockProvider(notes);
    const result = await generateReleaseNotes(provider, sampleInput.packages[0]?.entries, {
      packageName: 'my-lib',
      version: '2.0.0',
      date: '2026-01-15',
    });
    expect(result).toBe(notes);
  });
});

// ---------------------------------------------------------------------------
// Pipeline: LLM error falls back gracefully
// ---------------------------------------------------------------------------

describe('Pipeline: LLM error fallback', () => {
  it('runPipeline does not throw when LLM createProvider throws', async () => {
    // 'nonexistent-provider' will throw LLMError inside createProvider,
    // which is caught by the try/catch in processWithLLM → falls back to raw entries.
    const config: Config = {
      output: [{ format: 'markdown', file: '/dev/null' }],
      llm: { provider: 'nonexistent-provider', model: 'any', tasks: { enhance: true } },
    };

    await expect(runPipeline(sampleInput, config, false)).resolves.not.toThrow();
  });
});
