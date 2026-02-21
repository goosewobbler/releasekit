import { describe, expect, it } from 'vitest';
import type { ChangelogEntry } from '../../src/core/types.js';
import type { LLMProvider } from '../../src/llm/provider.js';
import { categorizeEntries } from '../../src/llm/tasks/categorize.js';
import { enhanceEntries, enhanceEntry } from '../../src/llm/tasks/enhance.js';
import { generateReleaseNotes } from '../../src/llm/tasks/release-notes.js';
import { summarizeEntries } from '../../src/llm/tasks/summarize.js';

// ---------------------------------------------------------------------------
// Mock provider
// ---------------------------------------------------------------------------

function makeMockProvider(response: string | ((prompt: string) => string)): LLMProvider & { callCount: number } {
  let callCount = 0;
  return {
    name: 'mock',
    get callCount() {
      return callCount;
    },
    async complete(prompt: string): Promise<string> {
      callCount++;
      return typeof response === 'function' ? response(prompt) : response;
    },
  };
}

function makeFailingProvider(after = 0): LLMProvider {
  let calls = 0;
  return {
    name: 'mock-failing',
    async complete(): Promise<string> {
      calls++;
      if (calls > after) throw new Error('provider error');
      return 'ok';
    },
  };
}

const sampleEntries: ChangelogEntry[] = [
  { type: 'added', description: 'Add streaming support', scope: 'api' },
  { type: 'fixed', description: 'Fix null pointer in parser' },
  { type: 'changed', description: 'Refactor config loading' },
];

const llmContext = { packageName: 'my-lib', version: '2.0.0', previousVersion: '1.0.0' };

// ---------------------------------------------------------------------------
// enhanceEntry
// ---------------------------------------------------------------------------

describe('enhanceEntry()', () => {
  it('returns the provider response as the new description', async () => {
    const provider = makeMockProvider('Add real-time streaming to the API');
    const entry = sampleEntries[0];
    if (!entry) throw new Error('No sample entry');
    const result = await enhanceEntry(provider, entry, llmContext);
    expect(result).toBe('Add real-time streaming to the API');
  });

  it('trims whitespace from the response', async () => {
    const provider = makeMockProvider('  trimmed  ');
    const entry = sampleEntries[0];
    if (!entry) throw new Error('No sample entry');
    const result = await enhanceEntry(provider, entry, llmContext);
    expect(result).toBe('trimmed');
  });

  it('calls the provider exactly once', async () => {
    const provider = makeMockProvider('response');
    const entry = sampleEntries[0];
    if (!entry) throw new Error('No sample entry');
    await enhanceEntry(provider, entry, llmContext);
    expect(provider.callCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// enhanceEntries
// ---------------------------------------------------------------------------

describe('enhanceEntries()', () => {
  it('enhances all entries', async () => {
    const provider = makeMockProvider('Enhanced description');
    const result = await enhanceEntries(provider, sampleEntries, llmContext);

    expect(result).toHaveLength(3);
    expect(result.every((e) => e.description === 'Enhanced description')).toBe(true);
  });

  it('preserves other entry fields (type, scope, issueIds)', async () => {
    const provider = makeMockProvider('New description');
    const result = await enhanceEntries(provider, sampleEntries, llmContext);

    expect(result[0]?.type).toBe('added');
    expect(result[0]?.scope).toBe('api');
    expect(result[1]?.type).toBe('fixed');
  });

  it('falls back to original entry when enhancement fails', async () => {
    // fails on all calls
    const provider = makeFailingProvider(0);
    const result = await enhanceEntries(provider, sampleEntries, llmContext);

    expect(result).toHaveLength(3);
    expect(result[0]?.description).toBe('Add streaming support');
  });

  it('processes entries in concurrent batches (all entries complete)', async () => {
    const provider = makeMockProvider('done');
    // 7 entries, concurrency 3 → 3 batches
    const manyEntries: ChangelogEntry[] = Array.from({ length: 7 }, (_, i) => ({
      type: 'added' as const,
      description: `Entry ${i}`,
    }));

    const result = await enhanceEntries(provider, manyEntries, llmContext, 3);
    expect(result).toHaveLength(7);
    expect(provider.callCount).toBe(7);
  });

  it('a failure in one batch entry does not block the rest of the batch', async () => {
    let calls = 0;
    const provider: LLMProvider = {
      name: 'mixed',
      async complete(): Promise<string> {
        calls++;
        if (calls === 2) throw new Error('second entry fails');
        return 'ok';
      },
    };

    const result = await enhanceEntries(provider, sampleEntries, llmContext);
    expect(result).toHaveLength(3);
    expect(result[0]?.description).toBe('ok');
    expect(result[1]?.description).toBe('Fix null pointer in parser'); // original preserved
    expect(result[2]?.description).toBe('ok');
  });
});

// ---------------------------------------------------------------------------
// summarizeEntries
// ---------------------------------------------------------------------------

describe('summarizeEntries()', () => {
  it('returns the provider response as the summary', async () => {
    const provider = makeMockProvider('Major release with streaming and fixes.');
    const result = await summarizeEntries(provider, sampleEntries, llmContext);
    expect(result).toBe('Major release with streaming and fixes.');
  });

  it('makes exactly one provider call', async () => {
    const provider = makeMockProvider('summary');
    await summarizeEntries(provider, sampleEntries, llmContext);
    expect(provider.callCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// categorizeEntries
// ---------------------------------------------------------------------------

describe('categorizeEntries()', () => {
  it('parses valid JSON response into categories', async () => {
    const jsonResponse = JSON.stringify({ 'New Features': [0], 'Bug Fixes': [1, 2] });
    const provider = makeMockProvider(jsonResponse);
    const result = await categorizeEntries(provider, sampleEntries, llmContext);

    expect(result).toHaveLength(2);
    const features = result.find((c) => c.category === 'New Features');
    expect(features?.entries).toHaveLength(1);
    expect(features?.entries[0]?.description).toBe('Add streaming support');

    const bugs = result.find((c) => c.category === 'Bug Fixes');
    expect(bugs?.entries).toHaveLength(2);
  });

  it('strips markdown code fences before parsing JSON', async () => {
    const fencedJson = '```json\n{"General": [0, 1, 2]}\n```';
    const provider = makeMockProvider(fencedJson);
    const result = await categorizeEntries(provider, sampleEntries, llmContext);

    expect(result[0]?.category).toBe('General');
    expect(result[0]?.entries).toHaveLength(3);
  });

  it('falls back to General category on invalid JSON', async () => {
    const provider = makeMockProvider('not valid json at all');
    const result = await categorizeEntries(provider, sampleEntries, llmContext);

    expect(result).toHaveLength(1);
    expect(result[0]?.category).toBe('General');
    expect(result[0]?.entries).toHaveLength(3);
  });

  it('returns empty array for empty entries', async () => {
    const provider = makeMockProvider('{}');
    const result = await categorizeEntries(provider, [], llmContext);
    expect(result).toHaveLength(0);
  });

  it('ignores out-of-range indices gracefully', async () => {
    const provider = makeMockProvider(JSON.stringify({ Core: [0, 99] })); // 99 is out of range
    const result = await categorizeEntries(provider, sampleEntries, llmContext);
    const core = result.find((c) => c.category === 'Core');
    expect(core?.entries).toHaveLength(1); // only index 0 is valid
  });
});

// ---------------------------------------------------------------------------
// generateReleaseNotes
// ---------------------------------------------------------------------------

describe('generateReleaseNotes()', () => {
  it('returns the provider response', async () => {
    const notes = 'This release adds streaming support and fixes a critical bug.';
    const provider = makeMockProvider(notes);
    const context = { ...llmContext, date: '2026-01-15' };
    const result = await generateReleaseNotes(provider, sampleEntries, context);
    expect(result).toBe(notes);
  });

  it('makes exactly one provider call', async () => {
    const provider = makeMockProvider('notes');
    await generateReleaseNotes(provider, sampleEntries, { ...llmContext, date: '2026-01-15' });
    expect(provider.callCount).toBe(1);
  });
});
