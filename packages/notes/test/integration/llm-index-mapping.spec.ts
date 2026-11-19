import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runPipeline } from '../../src/core/pipeline.js';
import type { ChangelogInput, LLMConfig } from '../../src/core/types.js';
import { createProvider } from '../../src/llm/index.js';
import type { LLMMessage } from '../../src/llm/messages.js';

vi.mock('../../src/llm/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/llm/index.js')>();
  return { ...actual, createProvider: vi.fn() };
});

const input: ChangelogInput = {
  source: 'version',
  packages: [
    {
      packageName: '@acme/app',
      version: '2.0.0',
      previousVersion: 'v1.5.0',
      revisionRange: 'v1.5.0..HEAD',
      repoUrl: null,
      date: '2026-01-15',
      entries: [
        { type: 'changed', description: 'drop the legacy preset', breaking: true },
        { type: 'added', description: 'add deep links' },
        { type: 'fixed', description: 'fix a renderer leak' },
      ],
    },
  ],
};

const categories = [
  { name: 'New', description: 'New features' },
  { name: 'Fixed', description: 'Bug fixes' },
  { name: 'Changed', description: 'Changes' },
];

function llm(tasks: LLMConfig['tasks'], llmCategories: LLMConfig['categories'] = categories): LLMConfig {
  return { provider: 'mock', model: 'mock', tasks, categories: llmCategories, examples: 0 };
}

const outputs = {
  preset: { index: 0, description: 'Dropped the legacy preset', category: 'Changed', scope: null, leadIn: null },
  deepLinks: { index: 1, description: 'Added deep links', category: 'New', scope: null, leadIn: null },
  leak: { index: 2, description: 'Fixed a renderer leak', category: 'Fixed', scope: null, leadIn: null },
};

/** Answers each attempt with the next response, recording what it was sent. */
function stubProvider(responses: unknown[][]): { calls: LLMMessage[][] } {
  const calls: LLMMessage[][] = [];
  vi.mocked(createProvider).mockReturnValue({
    name: 'mock',
    capabilities: { systemRole: true, structuredOutputs: false, toolUse: false },
    complete: async (messages) => {
      calls.push(messages);
      return { content: JSON.stringify({ entries: responses[calls.length - 1] }) };
    },
  });
  return { calls };
}

async function releaseNotes(
  tasks: LLMConfig['tasks'],
  llmCategories?: LLMConfig['categories'],
): Promise<string | undefined> {
  const result = await runPipeline(
    input,
    { changelog: false, releaseNotes: { llm: llm(tasks, llmCategories) } },
    false,
  );
  return result.releaseNotes?.['@acme/app'];
}

const ENHANCED_NOTES = `## [@acme/app@2.0.0] - 2026-01-15

### Breaking

- Dropped the legacy preset

### New

- Added deep links

### Fixed

- Fixed a renderer leak
`;

describe('Pipeline: LLM output maps to entries by index', () => {
  beforeEach(() => {
    vi.mocked(createProvider).mockReset();
  });

  it('should give each entry its own description and category when enhance output is reordered', async () => {
    stubProvider([[outputs.leak, outputs.deepLinks, outputs.preset]]);

    expect(await releaseNotes({ enhance: true, categorize: true })).toBe(ENHANCED_NOTES);
  });

  it('should give each entry its own category when categorize output is reordered', async () => {
    const strip = ({ index, category, scope }: typeof outputs.preset) => ({ index, category, scope });
    stubProvider([[strip(outputs.leak), strip(outputs.preset), strip(outputs.deepLinks)]]);

    expect(await releaseNotes({ categorize: true })).toBe(`## [@acme/app@2.0.0] - 2026-01-15

### Breaking

- drop the legacy preset

### New

- add deep links

### Fixed

- fix a renderer leak
`);
  });

  it('should send output with an unknown entry back for correction instead of shifting descriptions', async () => {
    const extra = { index: 3, description: 'Bumped CodeQL', category: 'Changed', scope: null, leadIn: null };
    const { calls } = stubProvider([
      [extra, outputs.preset, outputs.deepLinks, outputs.leak],
      [outputs.preset, outputs.deepLinks, outputs.leak],
    ]);

    expect(await releaseNotes({ enhance: true, categorize: true })).toBe(ENHANCED_NOTES);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.at(-1)?.content).toContain('unknown index 3');
  });

  it('should not move an entry under Breaking when the model marks it breaking', async () => {
    stubProvider([[outputs.preset, { ...outputs.deepLinks, breaking: true }, { ...outputs.leak, breaking: true }]]);

    expect(await releaseNotes({ enhance: true, categorize: true })).toBe(ENHANCED_NOTES);
  });
});

describe('Pipeline: only the commit puts an entry under Breaking', () => {
  beforeEach(() => {
    vi.mocked(createProvider).mockReset();
  });

  it.each([
    ['config lists Breaking', [{ name: 'Breaking', description: 'Breaking changes' }, ...categories]],
    ['config lists no categories', []],
  ])('should not offer Breaking and should send it back for correction when the %s', async (_label, llmCategories) => {
    const { calls } = stubProvider([
      [outputs.preset, { ...outputs.deepLinks, category: 'Breaking' }, outputs.leak],
      [outputs.preset, outputs.deepLinks, outputs.leak],
    ]);

    expect(await releaseNotes({ enhance: true, categorize: true }, llmCategories)).toBe(ENHANCED_NOTES);
    expect(calls[0]?.[0]?.content).not.toContain('"Breaking"');
    expect(calls).toHaveLength(2);
    expect(calls[1]?.at(-1)?.content).toContain('Unknown categories: Breaking');
  });
});
