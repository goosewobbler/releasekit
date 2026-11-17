import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChangelogInput, Config } from '../../src/core/types.js';
import type { CompleteResult, LLMMessage } from '../../src/llm/messages.js';
import type { LLMProvider } from '../../src/llm/provider.js';

vi.mock('../../src/llm/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/llm/index.js')>();
  return { ...actual, createProvider: vi.fn() };
});

const input: ChangelogInput = {
  source: 'version',
  packages: [
    {
      packageName: 'my-lib',
      version: '2.0.0',
      previousVersion: '1.0.0',
      revisionRange: 'v1.0.0..HEAD',
      repoUrl: null,
      date: '2026-01-15',
      entries: [
        { type: 'added', description: 'Add streaming support' },
        { type: 'fixed', description: 'Fix null pointer' },
      ],
    },
  ],
};

const ENHANCED = JSON.stringify({
  entries: [
    { description: 'Polished streaming', category: 'Highlights', scope: null, breaking: null, leadIn: null },
    { description: 'Polished fix', category: 'Highlights', scope: null, breaking: null, leadIn: null },
  ],
});
const SUMMARY = 'LLM summary of the release.';

describe('Pipeline: the changelog is LLM-free', () => {
  let dir: string;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'releasekit-changelog-llm-free-'));
    const { createProvider } = await import('../../src/llm/index.js');
    const provider: LLMProvider = {
      name: 'mock',
      capabilities: { systemRole: true, structuredOutputs: false, toolUse: false },
      async complete(messages: LLMMessage[]): Promise<CompleteResult> {
        return messages[0]?.content.includes('summary')
          ? { content: SUMMARY }
          : { content: ENHANCED, structured: JSON.parse(ENHANCED) };
      },
    };
    vi.mocked(createProvider).mockReturnValue(provider);
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('should render the changelog from the raw entries while the release notes get the LLM output', async () => {
    const { runPipeline } = await import('../../src/core/pipeline.js');
    const config: Config = {
      changelog: { mode: 'root', file: path.join(dir, 'CHANGELOG.md') },
      releaseNotes: {
        file: { dir: path.join(dir, 'release-notes') },
        llm: {
          provider: 'mock',
          model: 'mock',
          tasks: { enhance: true, categorize: true, summarize: true },
          examples: 0,
        },
      },
    };

    const result = await runPipeline(input, config, false);

    const changelog = fs.readFileSync(path.join(dir, 'CHANGELOG.md'), 'utf-8');
    expect(changelog).toContain('### Added\n\n- Add streaming support');
    expect(changelog).toContain('### Fixed\n\n- Fix null pointer');
    expect(changelog).not.toContain('Highlights');
    expect(changelog).not.toContain('Polished');
    expect(changelog).not.toContain(SUMMARY);

    const notesFile = result.files.find((file) => file.startsWith(path.join(dir, 'release-notes')));
    for (const notes of [result.releaseNotes?.['my-lib'], fs.readFileSync(notesFile ?? '', 'utf-8')]) {
      expect(notes).toContain(SUMMARY);
      expect(notes).toContain('### Highlights\n\n- Polished streaming\n- Polished fix');
    }
  });
});
