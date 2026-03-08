import { describe, expect, it } from 'vitest';
import type { ChangelogEntry } from '../../src/core/types.js';
import type { LLMProvider } from '../../src/llm/provider.js';
import { categorizeEntries } from '../../src/llm/tasks/categorize.js';
import { enhanceEntries, enhanceEntry } from '../../src/llm/tasks/enhance.js';
import { enhanceAndCategorize } from '../../src/llm/tasks/enhance-and-categorize.js';
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

  it('clears existing scopes from entries before categorization', async () => {
    const entriesWithScopes: ChangelogEntry[] = [
      { type: 'added', description: 'Add feature', scope: 'version' },
      { type: 'fixed', description: 'Fix bug', scope: 'notes' },
    ];
    const provider = makeMockProvider(JSON.stringify({ General: [0, 1] }));
    const result = await categorizeEntries(provider, entriesWithScopes, llmContext);

    // Scopes should be cleared since LLM didn't assign new ones
    expect(result[0]?.entries[0]?.scope).toBeUndefined();
    expect(result[0]?.entries[1]?.scope).toBeUndefined();
  });

  it('validates scopes against restricted scope config', async () => {
    const entries: ChangelogEntry[] = [
      { type: 'added', description: 'Update CI config' },
      { type: 'fixed', description: 'Fix deps' },
    ];
    const provider = makeMockProvider(
      JSON.stringify({
        categories: { Developer: [0, 1] },
        scopes: { '0': 'CI', '1': 'InvalidScope' },
      }),
    );

    const result = await categorizeEntries(provider, entries, {
      ...llmContext,
      categories: [{ name: 'Developer', description: 'Internal', scopes: ['CI', 'Dependencies'] }],
      scopes: { mode: 'restricted' },
    });

    const dev = result.find((c) => c.category === 'Developer');
    expect(dev?.entries[0]?.scope).toBe('CI');
    expect(dev?.entries[1]?.scope).toBeUndefined(); // InvalidScope removed
  });

  it('strips all scopes when scope mode is none', async () => {
    const entries: ChangelogEntry[] = [{ type: 'added', description: 'Update CI' }];
    const provider = makeMockProvider(
      JSON.stringify({
        categories: { Developer: [0] },
        scopes: { '0': 'CI' },
      }),
    );

    const result = await categorizeEntries(provider, entries, {
      ...llmContext,
      categories: [{ name: 'Developer', description: 'Internal', scopes: ['CI'] }],
      scopes: { mode: 'none' },
    });

    expect(result[0]?.entries[0]?.scope).toBeUndefined();
  });

  it('passes prompt instructions to the provider', async () => {
    let capturedPrompt = '';
    const provider = makeMockProvider((prompt) => {
      capturedPrompt = prompt;
      return JSON.stringify({ General: [0] });
    });

    await categorizeEntries(provider, [{ type: 'added', description: 'Test' }], {
      ...llmContext,
      prompts: { instructions: { categorize: 'Always use the Developer category.' } },
    });

    expect(capturedPrompt).toContain('Always use the Developer category.');
    expect(capturedPrompt).toContain('Additional instructions:');
  });

  it('applies scopes from LLM response when provided', async () => {
    const entriesWithoutScopes: ChangelogEntry[] = [
      { type: 'added', description: 'Update dependencies' },
      { type: 'fixed', description: 'Fix bug' },
    ];
    const provider = makeMockProvider(
      JSON.stringify({
        categories: { Developer: [0], Fixed: [1] },
        scopes: { '0': 'Dependencies' },
      }),
    );

    const result = await categorizeEntries(provider, entriesWithoutScopes, {
      ...llmContext,
      categories: [
        { name: 'Developer', description: 'Internal changes', scopes: ['Dependencies', 'CI'] },
        { name: 'Fixed', description: 'Bug fixes' },
      ],
    });

    const devCategory = result.find((c) => c.category === 'Developer');
    expect(devCategory?.entries[0]?.scope).toBe('Dependencies');

    const fixedCategory = result.find((c) => c.category === 'Fixed');
    expect(fixedCategory?.entries[0]?.scope).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// enhanceAndCategorize (combined single-call)
// ---------------------------------------------------------------------------

describe('enhanceAndCategorize()', () => {
  it('parses valid response into enhanced entries and categories', async () => {
    const response = JSON.stringify({
      entries: [
        { description: 'Added real-time streaming to the API', category: 'New', scope: null },
        { description: 'Fixed null pointer in parser', category: 'Fixed', scope: null },
        { description: 'Refactored config loading', category: 'Developer', scope: 'Code Quality' },
      ],
    });
    const provider = makeMockProvider(response);
    const result = await enhanceAndCategorize(provider, sampleEntries, llmContext);

    expect(result.enhancedEntries).toHaveLength(3);
    expect(result.enhancedEntries[0]?.description).toBe('Added real-time streaming to the API');
    expect(result.enhancedEntries[2]?.scope).toBe('Code Quality');

    expect(result.categories).toHaveLength(3);
    expect(result.categories.find((c) => c.category === 'New')?.entries).toHaveLength(1);
    expect(result.categories.find((c) => c.category === 'Fixed')?.entries).toHaveLength(1);
    expect(result.categories.find((c) => c.category === 'Developer')?.entries).toHaveLength(1);
  });

  it('makes exactly one provider call', async () => {
    const response = JSON.stringify({
      entries: [
        { description: 'a', category: 'General', scope: null },
        { description: 'b', category: 'General', scope: null },
        { description: 'c', category: 'General', scope: null },
      ],
    });
    const provider = makeMockProvider(response);
    await enhanceAndCategorize(provider, sampleEntries, llmContext);
    expect(provider.callCount).toBe(1);
  });

  it('preserves original entry fields (type, issueIds)', async () => {
    const response = JSON.stringify({
      entries: [
        { description: 'New desc', category: 'New', scope: null },
        { description: 'Fixed desc', category: 'Fixed', scope: null },
        { description: 'Changed desc', category: 'Changed', scope: null },
      ],
    });
    const provider = makeMockProvider(response);
    const result = await enhanceAndCategorize(provider, sampleEntries, llmContext);

    expect(result.enhancedEntries[0]?.type).toBe('added');
    expect(result.enhancedEntries[1]?.type).toBe('fixed');
    expect(result.enhancedEntries[2]?.type).toBe('changed');
  });

  it('preserves original scope when LLM returns null scope', async () => {
    const response = JSON.stringify({
      entries: [
        { description: 'New desc', category: 'New', scope: null },
        { description: 'Fixed desc', category: 'Fixed', scope: null },
        { description: 'Changed desc', category: 'Changed', scope: null },
      ],
    });
    const provider = makeMockProvider(response);
    const result = await enhanceAndCategorize(provider, sampleEntries, llmContext);

    // First entry had scope 'api' originally
    expect(result.enhancedEntries[0]?.scope).toBe('api');
  });

  it('strips markdown code fences before parsing', async () => {
    const response =
      '```json\n' +
      JSON.stringify({
        entries: [
          { description: 'a', category: 'General', scope: null },
          { description: 'b', category: 'General', scope: null },
          { description: 'c', category: 'General', scope: null },
        ],
      }) +
      '\n```';
    const provider = makeMockProvider(response);
    const result = await enhanceAndCategorize(provider, sampleEntries, llmContext);
    expect(result.enhancedEntries).toHaveLength(3);
  });

  it('falls back to General category on invalid JSON', async () => {
    const provider = makeMockProvider('not valid json');
    const result = await enhanceAndCategorize(provider, sampleEntries, llmContext);

    expect(result.enhancedEntries).toHaveLength(3);
    expect(result.enhancedEntries[0]?.description).toBe('Add streaming support'); // original preserved
    expect(result.categories).toHaveLength(1);
    expect(result.categories[0]?.category).toBe('General');
  });

  it('falls back when response is missing entries array', async () => {
    const provider = makeMockProvider(JSON.stringify({ categories: {} }));
    const result = await enhanceAndCategorize(provider, sampleEntries, llmContext);

    expect(result.enhancedEntries[0]?.description).toBe('Add streaming support');
    expect(result.categories[0]?.category).toBe('General');
  });

  it('handles provider error gracefully', async () => {
    const provider = makeFailingProvider(0);
    const result = await enhanceAndCategorize(provider, sampleEntries, llmContext);

    expect(result.enhancedEntries).toHaveLength(3);
    expect(result.categories[0]?.category).toBe('General');
  });

  it('returns empty results for empty entries', async () => {
    const provider = makeMockProvider('{}');
    const result = await enhanceAndCategorize(provider, [], llmContext);
    expect(result.enhancedEntries).toHaveLength(0);
    expect(result.categories).toHaveLength(0);
    expect(provider.callCount).toBe(0);
  });

  it('retries on invalid JSON and succeeds on subsequent attempt', async () => {
    let callCount = 0;
    const validResponse = JSON.stringify({
      entries: [
        { description: 'Success after retry', category: 'New', scope: null },
        { description: 'Fixed', category: 'Fixed', scope: null },
        { description: 'Changed', category: 'Changed', scope: null },
      ],
    });
    const provider: LLMProvider & { callCount: number } = {
      name: 'mock-retry',
      get callCount() {
        return callCount;
      },
      async complete(): Promise<string> {
        callCount++;
        if (callCount < 3) {
          return 'invalid json { missing';
        }
        return validResponse;
      },
    };

    const result = await enhanceAndCategorize(provider, sampleEntries, llmContext);

    expect(provider.callCount).toBe(3);
    expect(result.enhancedEntries[0]?.description).toBe('Success after retry');
    expect(result.categories).toHaveLength(3);
  });

  it('retries up to 3 times on persistent failures', async () => {
    const provider = makeMockProvider('always invalid json');
    const result = await enhanceAndCategorize(provider, sampleEntries, llmContext);

    expect(provider.callCount).toBe(3);
    expect(result.categories[0]?.category).toBe('General');
  });

  it('validates scopes against restricted scope config', async () => {
    const response = JSON.stringify({
      entries: [
        { description: 'Updated CI', category: 'Developer', scope: 'CI' },
        { description: 'Fixed bug', category: 'Fixed', scope: 'InvalidScope' },
        { description: 'Refactored', category: 'Developer', scope: 'Code Quality' },
      ],
    });
    const provider = makeMockProvider(response);
    const result = await enhanceAndCategorize(provider, sampleEntries, {
      ...llmContext,
      categories: [
        { name: 'Developer', description: 'Internal', scopes: ['CI', 'Dependencies'] },
        { name: 'Fixed', description: 'Bug fixes' },
      ],
      scopes: { mode: 'restricted' },
    });

    expect(result.enhancedEntries[0]?.scope).toBe('CI'); // allowed
    expect(result.enhancedEntries[1]?.scope).toBeUndefined(); // InvalidScope removed
    expect(result.enhancedEntries[2]?.scope).toBeUndefined(); // Code Quality not in allowed list
  });

  it('passes prompt instructions to the provider', async () => {
    let capturedPrompt = '';
    const provider = makeMockProvider((prompt) => {
      capturedPrompt = prompt;
      return JSON.stringify({
        entries: [
          { description: 'a', category: 'General', scope: null },
          { description: 'b', category: 'General', scope: null },
          { description: 'c', category: 'General', scope: null },
        ],
      });
    });

    await enhanceAndCategorize(provider, sampleEntries, {
      ...llmContext,
      prompts: { instructions: { enhanceAndCategorize: 'Focus on user impact.' } },
    });

    expect(capturedPrompt).toContain('Focus on user impact.');
    expect(capturedPrompt).toContain('Additional instructions:');
  });

  it('handles partial LLM response (fewer entries than input)', async () => {
    const response = JSON.stringify({
      entries: [
        { description: 'Only first', category: 'New', scope: null },
        // missing entries 1 and 2
      ],
    });
    const provider = makeMockProvider(response);
    const result = await enhanceAndCategorize(provider, sampleEntries, llmContext);

    expect(result.enhancedEntries).toHaveLength(3);
    expect(result.enhancedEntries[0]?.description).toBe('Only first');
    // Missing entries fall back to originals
    expect(result.enhancedEntries[1]?.description).toBe('Fix null pointer in parser');
    expect(result.enhancedEntries[2]?.description).toBe('Refactor config loading');
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
