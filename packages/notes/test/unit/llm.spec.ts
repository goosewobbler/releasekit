import { describe, expect, it } from 'vitest';
import type { ChangelogEntry, CompleteOptions } from '../../src/core/types.js';
import { LLMError } from '../../src/errors/index.js';
import type { CompleteResult, LLMMessage } from '../../src/llm/messages.js';
import type { LLMProvider } from '../../src/llm/provider.js';
import { categorizeEntries } from '../../src/llm/tasks/categorize.js';
import { enhanceEntries, enhanceEntry } from '../../src/llm/tasks/enhance.js';
import { enhanceAndCategorize } from '../../src/llm/tasks/enhance-and-categorize.js';
import { generateReleaseNotes } from '../../src/llm/tasks/release-notes.js';
import { summarizeEntries } from '../../src/llm/tasks/summarize.js';

// ---------------------------------------------------------------------------
// Mock provider
// ---------------------------------------------------------------------------

function makeMockProvider(
  response: string | ((messages: LLMMessage[]) => string),
): LLMProvider & { callCount: number } {
  let callCount = 0;
  return {
    name: 'mock',
    capabilities: { systemRole: true, structuredOutputs: false, toolUse: false },
    get callCount() {
      return callCount;
    },
    async complete(messages: LLMMessage[]): Promise<CompleteResult> {
      callCount++;
      const content = typeof response === 'function' ? response(messages) : response;
      try {
        const structured = JSON.parse(content);
        return { content, structured };
      } catch {
        return { content };
      }
    },
  };
}

function makeFailingProvider(after = 0): LLMProvider {
  let calls = 0;
  return {
    name: 'mock-failing',
    capabilities: { systemRole: true, structuredOutputs: false, toolUse: false },
    async complete(): Promise<CompleteResult> {
      calls++;
      if (calls > after) throw new Error('provider error');
      return { content: 'ok' };
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
  it('should return the provider response as the new description', async () => {
    const provider = makeMockProvider('Add real-time streaming to the API');
    const entry = sampleEntries[0];
    if (!entry) throw new Error('No sample entry');
    const result = await enhanceEntry(provider, entry, llmContext);
    expect(result).toBe('Add real-time streaming to the API');
  });

  it('should trim whitespace from the response', async () => {
    const provider = makeMockProvider('  trimmed  ');
    const entry = sampleEntries[0];
    if (!entry) throw new Error('No sample entry');
    const result = await enhanceEntry(provider, entry, llmContext);
    expect(result).toBe('trimmed');
  });

  it('should call the provider exactly once', async () => {
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
  it('should enhance all entries', async () => {
    const provider = makeMockProvider('Enhanced description');
    const result = await enhanceEntries(provider, sampleEntries, llmContext);

    expect(result).toHaveLength(3);
    expect(result.every((e) => e.description === 'Enhanced description')).toBe(true);
  });

  it('should preserve other entry fields (type, scope, issueIds)', async () => {
    const provider = makeMockProvider('New description');
    const result = await enhanceEntries(provider, sampleEntries, llmContext);

    expect(result[0]?.type).toBe('added');
    expect(result[0]?.scope).toBe('api');
    expect(result[1]?.type).toBe('fixed');
  });

  it('should fall back to original entry when enhancement fails', async () => {
    const provider = makeFailingProvider(0);
    const result = await enhanceEntries(provider, sampleEntries, llmContext);

    expect(result).toHaveLength(3);
    expect(result[0]?.description).toBe('Add streaming support');
  });

  it('should process entries in concurrent batches (all entries complete)', async () => {
    const provider = makeMockProvider('done');
    const manyEntries: ChangelogEntry[] = Array.from({ length: 7 }, (_, i) => ({
      type: 'added' as const,
      description: `Entry ${i}`,
    }));

    const result = await enhanceEntries(provider, manyEntries, llmContext, 3);
    expect(result).toHaveLength(7);
    expect(provider.callCount).toBe(7);
  });

  it('should not let a failure in one batch entry block the rest of the batch', async () => {
    let calls = 0;
    const provider: LLMProvider = {
      name: 'mixed',
      capabilities: { systemRole: true, structuredOutputs: false, toolUse: false },
      async complete(): Promise<CompleteResult> {
        calls++;
        if (calls === 2) throw new Error('second entry fails');
        return { content: 'ok' };
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
  it('should return the provider response as the summary', async () => {
    const provider = makeMockProvider('Major release with streaming and fixes.');
    const result = await summarizeEntries(provider, sampleEntries, llmContext);
    expect(result).toBe('Major release with streaming and fixes.');
  });

  it('should make exactly one provider call', async () => {
    const provider = makeMockProvider('summary');
    await summarizeEntries(provider, sampleEntries, llmContext);
    expect(provider.callCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// categorizeEntries
// ---------------------------------------------------------------------------

describe('categorizeEntries()', () => {
  it('should parse valid JSON response into categories', async () => {
    const jsonResponse = JSON.stringify({
      entries: [
        { category: 'New Features', scope: null },
        { category: 'Bug Fixes', scope: null },
        { category: 'Bug Fixes', scope: null },
      ],
    });
    const provider = makeMockProvider(jsonResponse);
    const result = await categorizeEntries(provider, sampleEntries, llmContext);

    expect(result).toHaveLength(2);
    const features = result.find((c) => c.category === 'New Features');
    expect(features?.entries).toHaveLength(1);
    expect(features?.entries[0]?.description).toBe('Add streaming support');

    const bugs = result.find((c) => c.category === 'Bug Fixes');
    expect(bugs?.entries).toHaveLength(2);
  });

  it('should return empty array for empty entries', async () => {
    const provider = makeMockProvider(JSON.stringify({ entries: [] }));
    const result = await categorizeEntries(provider, [], llmContext);
    expect(result).toHaveLength(0);
    expect(provider.callCount).toBe(0);
  });

  it('should clear existing scopes from entries before categorization', async () => {
    const entriesWithScopes: ChangelogEntry[] = [
      { type: 'added', description: 'Add feature', scope: 'version' },
      { type: 'fixed', description: 'Fix bug', scope: 'notes' },
    ];
    const provider = makeMockProvider(
      JSON.stringify({
        entries: [
          { category: 'General', scope: null },
          { category: 'General', scope: null },
        ],
      }),
    );
    const result = await categorizeEntries(provider, entriesWithScopes, llmContext);

    // Scopes should be cleared since LLM didn't assign new ones
    expect(result[0]?.entries[0]?.scope).toBeUndefined();
    expect(result[0]?.entries[1]?.scope).toBeUndefined();
  });

  it('should apply invalidScopeAction (default remove) without triggering an LLM retry', async () => {
    const entries: ChangelogEntry[] = [
      { type: 'added', description: 'Update CI config' },
      { type: 'fixed', description: 'Fix deps' },
    ];

    let callCount = 0;
    const provider: LLMProvider = {
      name: 'mock',
      capabilities: { systemRole: true, structuredOutputs: false, toolUse: false },
      async complete(): Promise<CompleteResult> {
        callCount++;
        const content = JSON.stringify({
          entries: [
            { category: 'Developer', scope: 'CI' },
            { category: 'Developer', scope: 'InvalidScope' },
          ],
        });
        return { content, structured: JSON.parse(content) };
      },
    };

    const result = await categorizeEntries(provider, entries, {
      ...llmContext,
      categories: [{ name: 'Developer', description: 'Internal', scopes: ['CI', 'Dependencies'] }],
      scopes: { mode: 'restricted' },
    });

    const dev = result.find((c) => c.category === 'Developer');
    expect(dev?.entries[0]?.scope).toBe('CI');
    // 'InvalidScope' is dropped per the default invalidScopeAction: 'remove'.
    expect(dev?.entries[1]?.scope).toBeUndefined();
    // Only one LLM call — scope mismatches are resolved by the configured action, not retried.
    expect(callCount).toBe(1);
  });

  it('should strip all scopes when scope mode is none', async () => {
    const entries: ChangelogEntry[] = [{ type: 'added', description: 'Update CI' }];

    // With mode: none, even valid scope causes a validation error; corrective retry
    // will eventually exhaust since no valid scope exists in empty allowed list.
    // To test the clean path: use a provider that returns null scope.
    const provider = makeMockProvider(JSON.stringify({ entries: [{ category: 'Developer', scope: null }] }));

    const result = await categorizeEntries(provider, entries, {
      ...llmContext,
      categories: [{ name: 'Developer', description: 'Internal', scopes: ['CI'] }],
      scopes: { mode: 'none' },
    });

    expect(result[0]?.entries[0]?.scope).toBeUndefined();
  });

  it('should pass prompt instructions to the provider in the system message', async () => {
    let capturedMessages: LLMMessage[] = [];
    const provider: LLMProvider = {
      name: 'mock',
      capabilities: { systemRole: true, structuredOutputs: false, toolUse: false },
      async complete(messages: LLMMessage[]): Promise<CompleteResult> {
        capturedMessages = messages;
        const content = JSON.stringify({ entries: [{ category: 'General', scope: null }] });
        return { content, structured: JSON.parse(content) };
      },
    };

    await categorizeEntries(provider, [{ type: 'added', description: 'Test' }], {
      ...llmContext,
      prompts: { instructions: { categorize: 'Always use the Developer category.' } },
    });

    const systemMsg = capturedMessages.find((m) => m.role === 'system');
    expect(systemMsg?.content).toContain('Always use the Developer category.');
  });

  it('should apply scopes from LLM response when provided', async () => {
    const entriesWithoutScopes: ChangelogEntry[] = [
      { type: 'added', description: 'Update dependencies' },
      { type: 'fixed', description: 'Fix bug' },
    ];
    const provider = makeMockProvider(
      JSON.stringify({
        entries: [
          { category: 'Developer', scope: 'Dependencies' },
          { category: 'Fixed', scope: null },
        ],
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

  it('should return General fallback when corrective retry is exhausted on persistent invalid JSON', async () => {
    const provider = makeMockProvider('not valid json at all');
    const result = await categorizeEntries(provider, sampleEntries, llmContext);
    expect(result).toHaveLength(1);
    expect(result[0]?.category).toBe('General');
    // Scopes are stripped in the fallback path — they were never LLM-validated.
    expect(result[0]?.entries[0]?.scope).toBeUndefined();
    expect(result[0]?.entries[0]?.description).toBe('Add streaming support');
  });

  it('should use free-form category prompt when categories is an empty array', async () => {
    let capturedMessages: LLMMessage[] = [];
    const provider: LLMProvider = {
      name: 'mock',
      capabilities: { systemRole: true, structuredOutputs: false, toolUse: false },
      async complete(messages: LLMMessage[]): Promise<CompleteResult> {
        capturedMessages = messages;
        const content = JSON.stringify({ entries: [{ category: 'New Features', scope: null }] });
        return { content };
      },
    };

    await categorizeEntries(provider, [{ type: 'added', description: 'Add feature' }], {
      ...llmContext,
      categories: [],
    });

    const systemMsg = capturedMessages.find((m) => m.role === 'system');
    expect(systemMsg?.content).not.toContain('use ONLY these exact names');
    expect(systemMsg?.content).toContain('Group into meaningful categories');
  });
});

// ---------------------------------------------------------------------------
// enhanceAndCategorize (combined single-call)
// ---------------------------------------------------------------------------

describe('enhanceAndCategorize()', () => {
  it('should parse valid response into enhanced entries and categories', async () => {
    const response = JSON.stringify({
      entries: [
        {
          description: 'Added real-time streaming to the API',
          category: 'New',
          scope: null,
          breaking: null,
          leadIn: null,
        },
        { description: 'Fixed null pointer in parser', category: 'Fixed', scope: null, breaking: null, leadIn: null },
        {
          description: 'Refactored config loading',
          category: 'Developer',
          scope: 'Code Quality',
          breaking: null,
          leadIn: null,
        },
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

  it('should make exactly one provider call for valid response', async () => {
    const response = JSON.stringify({
      entries: [
        { description: 'a', category: 'General', scope: null, breaking: null, leadIn: null },
        { description: 'b', category: 'General', scope: null, breaking: null, leadIn: null },
        { description: 'c', category: 'General', scope: null, breaking: null, leadIn: null },
      ],
    });
    const provider = makeMockProvider(response);
    await enhanceAndCategorize(provider, sampleEntries, llmContext);
    expect(provider.callCount).toBe(1);
  });

  it('should preserve original entry fields (type, issueIds)', async () => {
    const response = JSON.stringify({
      entries: [
        { description: 'New desc', category: 'New', scope: null, breaking: null, leadIn: null },
        { description: 'Fixed desc', category: 'Fixed', scope: null, breaking: null, leadIn: null },
        { description: 'Changed desc', category: 'Changed', scope: null, breaking: null, leadIn: null },
      ],
    });
    const provider = makeMockProvider(response);
    const result = await enhanceAndCategorize(provider, sampleEntries, llmContext);

    expect(result.enhancedEntries[0]?.type).toBe('added');
    expect(result.enhancedEntries[1]?.type).toBe('fixed');
    expect(result.enhancedEntries[2]?.type).toBe('changed');
  });

  it('should clear scope when LLM returns null scope', async () => {
    const response = JSON.stringify({
      entries: [
        { description: 'New desc', category: 'New', scope: null, breaking: null, leadIn: null },
        { description: 'Fixed desc', category: 'Fixed', scope: null, breaking: null, leadIn: null },
        { description: 'Changed desc', category: 'Changed', scope: null, breaking: null, leadIn: null },
      ],
    });
    const provider = makeMockProvider(response);
    const result = await enhanceAndCategorize(provider, sampleEntries, llmContext);

    // LLM returning null for scope means "no scope" — original scope is not preserved
    expect(result.enhancedEntries[0]?.scope).toBeUndefined();
  });

  it('should populate leadIn when provided by the LLM', async () => {
    const response = JSON.stringify({
      entries: [
        {
          description: 'Real-time streaming to the API',
          category: 'New',
          scope: null,
          breaking: null,
          leadIn: 'Streaming API',
        },
        { description: 'Fixed null pointer', category: 'Fixed', scope: null, breaking: null, leadIn: null },
        { description: 'Refactored config', category: 'Changed', scope: null, breaking: null, leadIn: null },
      ],
    });
    const provider = makeMockProvider(response);
    const result = await enhanceAndCategorize(provider, sampleEntries, llmContext);

    expect(result.enhancedEntries[0]?.leadIn).toBe('Streaming API');
    expect(result.enhancedEntries[1]?.leadIn).toBeUndefined();
  });

  it('should return empty results for empty entries', async () => {
    const provider = makeMockProvider('{}');
    const result = await enhanceAndCategorize(provider, [], llmContext);
    expect(result.enhancedEntries).toHaveLength(0);
    expect(result.categories).toHaveLength(0);
    expect(provider.callCount).toBe(0);
  });

  it('should retry on invalid JSON and succeed on subsequent attempt', async () => {
    let callCount = 0;
    const validResponse = JSON.stringify({
      entries: [
        { description: 'Success after retry', category: 'New', scope: null, breaking: null, leadIn: null },
        { description: 'Fixed', category: 'Fixed', scope: null, breaking: null, leadIn: null },
        { description: 'Changed', category: 'Changed', scope: null, breaking: null, leadIn: null },
      ],
    });
    const provider: LLMProvider & { callCount: number } = {
      name: 'mock-retry',
      capabilities: { systemRole: true, structuredOutputs: false, toolUse: false },
      get callCount() {
        return callCount;
      },
      async complete(): Promise<CompleteResult> {
        callCount++;
        if (callCount < 3) {
          return { content: 'invalid json { missing' };
        }
        return { content: validResponse, structured: JSON.parse(validResponse) };
      },
    };

    const result = await enhanceAndCategorize(provider, sampleEntries, llmContext);

    expect(provider.callCount).toBe(3);
    expect(result.enhancedEntries[0]?.description).toBe('Success after retry');
    expect(result.categories).toHaveLength(3);
  });

  it('should return General fallback when all corrective retry attempts fail', async () => {
    const provider = makeMockProvider('always invalid json');
    const result = await enhanceAndCategorize(provider, sampleEntries, llmContext);
    // Scopes and leadIns are stripped in the fallback path — they were never LLM-validated.
    expect(result.enhancedEntries[0]?.description).toBe('Add streaming support');
    expect(result.enhancedEntries[0]?.scope).toBeUndefined();
    expect(result.categories).toHaveLength(1);
    expect(result.categories[0]?.category).toBe('General');
    expect(provider.callCount).toBe(3); // 1 initial + 2 corrective
  });

  it('should truncate and warn when LLM returns more entries than expected', async () => {
    const response = JSON.stringify({
      entries: [
        { description: 'Enhanced A', category: 'New', scope: null, breaking: null, leadIn: null },
        { description: 'Enhanced B', category: 'Fixed', scope: null, breaking: null, leadIn: null },
        { description: 'Enhanced C', category: 'Changed', scope: null, breaking: null, leadIn: null },
        { description: 'Spurious extra', category: 'New', scope: null, breaking: null, leadIn: null },
        { description: 'Another extra', category: 'Fixed', scope: null, breaking: null, leadIn: null },
      ],
    });
    const provider = makeMockProvider(response);
    const result = await enhanceAndCategorize(provider, sampleEntries, llmContext);

    expect(provider.callCount).toBe(1);
    expect(result.enhancedEntries).toHaveLength(3);
    expect(result.enhancedEntries[0]?.description).toBe('Enhanced A');
    expect(result.enhancedEntries[2]?.description).toBe('Enhanced C');
  });

  it('should throw when provider errors on all attempts', async () => {
    const provider = makeFailingProvider(0);
    await expect(enhanceAndCategorize(provider, sampleEntries, llmContext)).rejects.toThrow();
  });

  it('should apply invalidScopeAction to disallowed scopes without retrying the LLM', async () => {
    const response = JSON.stringify({
      entries: [
        { description: 'Updated CI', category: 'Developer', scope: 'CI', breaking: null, leadIn: null },
        { description: 'Fixed bug', category: 'Fixed', scope: 'InvalidScope', breaking: null, leadIn: null },
        { description: 'Refactored', category: 'Developer', scope: 'Code Quality', breaking: null, leadIn: null },
      ],
    });

    let callCount = 0;
    const provider: LLMProvider = {
      name: 'mock',
      capabilities: { systemRole: true, structuredOutputs: false, toolUse: false },
      async complete(): Promise<CompleteResult> {
        callCount++;
        return { content: response, structured: JSON.parse(response) };
      },
    };

    const result = await enhanceAndCategorize(provider, sampleEntries, {
      ...llmContext,
      categories: [
        { name: 'Developer', description: 'Internal', scopes: ['CI', 'Dependencies'] },
        { name: 'Fixed', description: 'Bug fixes' },
      ],
      scopes: { mode: 'restricted' },
    });

    expect(result.enhancedEntries[0]?.scope).toBe('CI');
    // 'InvalidScope' and 'Code Quality' both fall outside the allowed set; default action `remove`.
    expect(result.enhancedEntries[1]?.scope).toBeUndefined();
    expect(result.enhancedEntries[2]?.scope).toBeUndefined();
    expect(callCount).toBe(1);
  });

  it('should pass prompt instructions to the provider in the system message', async () => {
    let capturedMessages: LLMMessage[] = [];
    const provider: LLMProvider = {
      name: 'mock',
      capabilities: { systemRole: true, structuredOutputs: false, toolUse: false },
      async complete(messages: LLMMessage[]): Promise<CompleteResult> {
        capturedMessages = messages;
        const content = JSON.stringify({
          entries: [
            { description: 'a', category: 'General', scope: null, breaking: null, leadIn: null },
            { description: 'b', category: 'General', scope: null, breaking: null, leadIn: null },
            { description: 'c', category: 'General', scope: null, breaking: null, leadIn: null },
          ],
        });
        return { content, structured: JSON.parse(content) };
      },
    };

    await enhanceAndCategorize(provider, sampleEntries, {
      ...llmContext,
      prompts: { instructions: { enhanceAndCategorize: 'Focus on user impact.' } },
    });

    const systemMsg = capturedMessages.find((m) => m.role === 'system');
    expect(systemMsg?.content).toContain('Focus on user impact.');
  });

  it('should return General fallback when response has fewer entries than input', async () => {
    // Only 1 entry in response for 3 inputs — count mismatch exhausts corrective retries → fallback.
    const response = JSON.stringify({
      entries: [{ description: 'Only first', category: 'New', scope: null, breaking: null, leadIn: null }],
    });

    const provider = makeMockProvider(response);
    const result = await enhanceAndCategorize(provider, sampleEntries, llmContext);
    // Scopes and leadIns are stripped in the fallback path — they were never LLM-validated.
    expect(result.enhancedEntries[0]?.description).toBe('Add streaming support');
    expect(result.enhancedEntries[0]?.scope).toBeUndefined();
    expect(result.categories[0]?.category).toBe('General');
  });

  it('should use free-form category prompt when categories is an empty array', async () => {
    let capturedMessages: LLMMessage[] = [];
    const provider: LLMProvider = {
      name: 'mock',
      capabilities: { systemRole: true, structuredOutputs: false, toolUse: false },
      async complete(messages: LLMMessage[]): Promise<CompleteResult> {
        capturedMessages = messages;
        const content = JSON.stringify({
          entries: [{ description: 'Added feature', category: 'New', scope: null, breaking: null, leadIn: null }],
        });
        return { content };
      },
    };

    await enhanceAndCategorize(provider, [{ type: 'added', description: 'Add feature' }], {
      ...llmContext,
      categories: [],
    });

    const systemMsg = capturedMessages.find((m) => m.role === 'system');
    expect(systemMsg?.content).not.toContain('use ONLY these exact names');
    expect(systemMsg?.content).toContain('Group into meaningful categories');
  });
});

// ---------------------------------------------------------------------------
// generateReleaseNotes
// ---------------------------------------------------------------------------

describe('generateReleaseNotes()', () => {
  it('should return the provider response', async () => {
    const notes = 'This release adds streaming support and fixes a critical bug.';
    const provider = makeMockProvider(notes);
    const context = { ...llmContext, date: '2026-01-15' };
    const result = await generateReleaseNotes(provider, sampleEntries, context);
    expect(result).toBe(notes);
  });

  it('should make exactly one provider call', async () => {
    const provider = makeMockProvider('notes');
    await generateReleaseNotes(provider, sampleEntries, { ...llmContext, date: '2026-01-15' });
    expect(provider.callCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// capabilities: schema options gating
// ---------------------------------------------------------------------------

describe('capabilities: schema options gating', () => {
  const threeEntryResponse = JSON.stringify({
    entries: [
      { description: 'a', category: 'General', scope: null, breaking: null, leadIn: null },
      { description: 'b', category: 'General', scope: null, breaking: null, leadIn: null },
      { description: 'c', category: 'General', scope: null, breaking: null, leadIn: null },
    ],
  });

  const threeEntryCategorizeResponse = JSON.stringify({
    entries: [
      { category: 'General', scope: null },
      { category: 'General', scope: null },
      { category: 'General', scope: null },
    ],
  });

  function makeCapabilityProvider(
    structuredOutputs: boolean,
    response: string,
    onComplete?: (options: CompleteOptions | undefined) => void,
  ): LLMProvider {
    return {
      name: 'cap-mock',
      capabilities: { systemRole: true, structuredOutputs, toolUse: false },
      async complete(_messages: LLMMessage[], options?: CompleteOptions): Promise<CompleteResult> {
        onComplete?.(options);
        const structured = JSON.parse(response);
        return { content: response, structured };
      },
    };
  }

  it('passes schema and toolName to enhanceAndCategorize when structuredOutputs is true', async () => {
    let captured: CompleteOptions | undefined;
    const provider = makeCapabilityProvider(true, threeEntryResponse, (o) => (captured = o));
    await enhanceAndCategorize(provider, sampleEntries, llmContext);
    expect(captured?.schema).toBeDefined();
    expect(captured?.toolName).toBe('emit_release_notes');
  });

  it('omits schema options from enhanceAndCategorize when structuredOutputs is false', async () => {
    let captured: CompleteOptions | undefined;
    const provider = makeCapabilityProvider(false, threeEntryResponse, (o) => (captured = o));
    await enhanceAndCategorize(provider, sampleEntries, llmContext);
    expect(captured).toBeUndefined();
  });

  it('passes schema and toolName to categorizeEntries when structuredOutputs is true', async () => {
    let captured: CompleteOptions | undefined;
    const provider = makeCapabilityProvider(true, threeEntryCategorizeResponse, (o) => (captured = o));
    await categorizeEntries(provider, sampleEntries, llmContext);
    expect(captured?.schema).toBeDefined();
    expect(captured?.toolName).toBe('categorize_entries');
  });

  it('omits schema options from categorizeEntries when structuredOutputs is false', async () => {
    let captured: CompleteOptions | undefined;
    const provider = makeCapabilityProvider(false, threeEntryCategorizeResponse, (o) => (captured = o));
    await categorizeEntries(provider, sampleEntries, llmContext);
    expect(captured).toBeUndefined();
  });
});
