import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runPipeline } from '../../src/core/pipeline.js';
import type { ChangelogInput } from '../../src/core/types.js';
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
  source: 'version',
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
  it('should not throw even when LLM provider is misconfigured', async () => {
    // If dry-run skips LLM, a nonexistent provider should not cause a failure.
    const config = {
      changelog: false as const,
      releaseNotes: {
        llm: { provider: 'nonexistent-provider', model: 'any', tasks: { enhance: true } },
      },
    };

    await expect(runPipeline(sampleInput, config, true)).resolves.not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// LLM enhance task with a mock provider (direct task tests)
// ---------------------------------------------------------------------------

describe('LLM tasks: enhance', () => {
  it('should replace entry descriptions with provider responses', async () => {
    const provider = makeMockProvider('Polished description');
    const result = await enhanceEntries(provider, sampleInput.packages[0]!.entries, {
      packageName: 'my-lib',
      version: '2.0.0',
    });

    expect(result).toHaveLength(3);
    expect(result.every((e) => e.description === 'Polished description')).toBe(true);
    expect(provider.callCount).toBe(3);
  });

  it('should preserve original entry when provider fails', async () => {
    const provider: LLMProvider = {
      name: 'failing',
      async complete(): Promise<string> {
        throw new Error('API down');
      },
    };

    const result = await enhanceEntries(provider, sampleInput.packages[0]!.entries, {});
    expect(result[0]?.description).toBe('Add streaming support');
    expect(result[1]?.description).toBe('Fix null pointer');
  });

  it('should respect the concurrency parameter', async () => {
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
  it('should return the summary from the provider', async () => {
    const provider = makeMockProvider('This release brings streaming and fixes.');
    const summary = await summarizeEntries(provider, sampleInput.packages[0]!.entries, {
      packageName: 'my-lib',
      version: '2.0.0',
    });
    expect(summary).toBe('This release brings streaming and fixes.');
    expect(provider.callCount).toBe(1);
  });
});

describe('LLM tasks: categorize', () => {
  it('should group entries by category from JSON response', async () => {
    const entries = sampleInput.packages[0]!.entries;
    const jsonResponse = JSON.stringify({ Features: [0], Fixes: [1], Maintenance: [2] });
    const provider = makeMockProvider(jsonResponse);

    const result = await categorizeEntries(provider, entries, { packageName: 'my-lib' });

    expect(result.find((c) => c.category === 'Features')?.entries[0]?.description).toBe('Add streaming support');
    expect(result.find((c) => c.category === 'Fixes')?.entries[0]?.description).toBe('Fix null pointer');
  });

  it('should fall back to General on invalid JSON and not throw', async () => {
    const provider = makeMockProvider('not json');
    const result = await categorizeEntries(provider, sampleInput.packages[0]!.entries, {});
    expect(result[0]?.category).toBe('General');
    expect(result[0]?.entries).toHaveLength(3);
  });
});

describe('LLM tasks: release notes', () => {
  it('should return release notes from the provider', async () => {
    const notes = '## v2.0.0\n\nThis release adds streaming and fixes a null pointer.';
    const provider = makeMockProvider(notes);
    const result = await generateReleaseNotes(provider, sampleInput.packages[0]!.entries, {
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
  it('should not throw when LLM createProvider throws', async () => {
    // 'nonexistent-provider' will throw LLMError inside createProvider,
    // which is caught by the try/catch in processWithLLM → falls back to raw entries.
    const config = {
      changelog: false as const,
      releaseNotes: {
        llm: { provider: 'nonexistent-provider', model: 'any', tasks: { enhance: true } },
      },
    };

    await expect(runPipeline(sampleInput, config, false)).resolves.not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Pipeline: package name in changelog headers
// ---------------------------------------------------------------------------

describe('Pipeline: package name in changelog headers', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'releasekit-pipeline-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should include scoped package name in version header', async () => {
    const scopedInput: ChangelogInput = {
      source: 'version',
      packages: [
        {
          packageName: '@releasekit/notes',
          version: '0.3.0',
          previousVersion: 'v0.2.0',
          revisionRange: 'v0.2.0..HEAD',
          repoUrl: 'https://github.com/goosewobbler/releasekit',
          date: '2026-03-18',
          entries: [{ type: 'added', description: 'New feature' }],
        },
      ],
    };

    const outFile = path.join(tmpDir, 'CHANGELOG.md');
    const config = {
      changelog: { mode: 'root' as const, file: outFile },
    };

    await runPipeline(scopedInput, config, false);

    const content = fs.readFileSync(outFile, 'utf-8');
    expect(content).toContain('## [@releasekit/notes@0.3.0]');
  });

  it('should omit package name for unscoped packages', async () => {
    const unscopedInput: ChangelogInput = {
      source: 'version',
      packages: [
        {
          packageName: 'my-lib',
          version: '2.0.0',
          previousVersion: 'v1.0.0',
          revisionRange: 'v1.0.0..HEAD',
          repoUrl: 'https://github.com/acme/my-lib',
          date: '2026-01-15',
          entries: [{ type: 'added', description: 'New feature' }],
        },
      ],
    };

    const outFile = path.join(tmpDir, 'CHANGELOG.md');
    const config = {
      changelog: { mode: 'root' as const, file: outFile },
    };

    await runPipeline(unscopedInput, config, false);

    const content = fs.readFileSync(outFile, 'utf-8');
    expect(content).toContain('## [2.0.0]');
    expect(content).not.toContain('my-lib@');
  });
});
