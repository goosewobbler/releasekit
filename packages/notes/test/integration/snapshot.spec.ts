import * as fs from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChangelogInput } from '../../src/core/types.js';
import type { CompleteResult, LLMMessage } from '../../src/llm/messages.js';
import type { LLMProvider } from '../../src/llm/provider.js';

vi.mock('../../src/llm/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/llm/index.js')>();
  return { ...actual, createProvider: vi.fn() };
});

vi.mock('node:fs');

// ---------------------------------------------------------------------------
// Input fixture — representative entries that exercise all render features
// ---------------------------------------------------------------------------

const sampleInput: ChangelogInput = {
  source: 'version',
  packages: [
    {
      packageName: '@acme/app',
      version: '2.0.0',
      previousVersion: 'v1.5.0',
      revisionRange: 'v1.5.0..HEAD',
      repoUrl: null, // disables example / PR-context fetching
      date: '2026-01-15',
      entries: [
        { type: 'changed', description: 'Rename connect() to initialize()', breaking: true },
        { type: 'added', description: 'Add deep link support via triggerDeeplink()' },
        { type: 'added', description: 'Add mock IPC support' },
        { type: 'fixed', description: 'Resolve memory leak in renderer process' },
        { type: 'changed', description: 'Migrate bundler to esbuild 0.20' },
      ],
    },
  ],
};

// Deterministic enhanceAndCategorize response.
// Exercises: breaking re-routing, leadIn phrases, scope grouping (ipc×2).
const MOCK_RESPONSE = JSON.stringify({
  entries: [
    {
      description: 'Rename connect() to initialize()',
      category: 'Breaking',
      scope: null,
      breaking: true,
      leadIn: 'API rename',
    },
    {
      description: 'Add deep link support via triggerDeeplink()',
      category: 'New',
      scope: 'ipc',
      breaking: null,
      leadIn: 'Deeplink testing',
    },
    { description: 'Add mock IPC support', category: 'New', scope: 'ipc', breaking: null, leadIn: null },
    {
      description: 'Resolve memory leak in renderer process',
      category: 'Fixed',
      scope: null,
      breaking: null,
      leadIn: null,
    },
    {
      description: 'Migrate bundler to esbuild 0.20',
      category: 'Developer',
      scope: null,
      breaking: null,
      leadIn: null,
    },
  ],
});

// ---------------------------------------------------------------------------
// Snapshot test
// ---------------------------------------------------------------------------

describe('Pipeline: render snapshot', () => {
  beforeEach(() => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined as never);
    vi.mocked(fs.writeFileSync).mockReturnValue(undefined);
  });

  it('renders Breaking first, scope groups, and leadIn phrases', async () => {
    const { createProvider } = await import('../../src/llm/index.js');
    const mockProvider: LLMProvider = {
      name: 'mock',
      capabilities: { systemRole: true, structuredOutputs: false, toolUse: false },
      async complete(_messages: LLMMessage[]): Promise<CompleteResult> {
        return { content: MOCK_RESPONSE, structured: JSON.parse(MOCK_RESPONSE) };
      },
    };
    vi.mocked(createProvider).mockReturnValue(mockProvider);

    const { runPipeline } = await import('../../src/core/pipeline.js');

    const result = await runPipeline(
      sampleInput,
      {
        changelog: false,
        releaseNotes: {
          llm: {
            provider: 'mock',
            model: 'mock',
            tasks: { categorize: true, enhance: true },
            examples: 0, // disable GitHub release fetching
          },
        },
      },
      false,
    );

    expect(result.packageNotes['@acme/app']).toMatchInlineSnapshot(`
      "## [2.0.0] - 2026-01-15

      ### Breaking
      - **BREAKING** **API rename**: Rename connect() to initialize()

      ### New
      **ipc**:
      - **Deeplink testing**: Add deep link support via triggerDeeplink()
      - Add mock IPC support

      ### Fixed
      - Resolve memory leak in renderer process

      ### Developer
      - Migrate bundler to esbuild 0.20
      "
    `);
  });
});
