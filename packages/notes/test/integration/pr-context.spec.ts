import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type ChangelogInput, runPipeline } from '../../src/index.js';
import type { CompleteResult, LLMMessage } from '../../src/llm/messages.js';

vi.mock('../../src/llm/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/llm/index.js')>();
  return { ...actual, createProvider: vi.fn() };
});

vi.mock('@releasekit/forge', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@releasekit/forge')>();
  return {
    ...actual,
    createGitHubForge: () =>
      actual.createFakeForge({
        issues: {
          10: { title: 'fix: respect refs', body: 'Own PR body', labels: [], isPullRequest: true },
          3: {
            title: 'chore(deps): bump codeql-action',
            body: 'Upstream release notes',
            labels: [],
            isPullRequest: true,
          },
          12: { title: 'Refs ignored', body: 'Issue body', labels: [], isPullRequest: false },
        },
      }),
  };
});

const input: ChangelogInput = {
  source: 'version',
  packages: [
    {
      packageName: 'my-lib',
      version: '2.0.0',
      previousVersion: 'v1.0.0',
      revisionRange: 'v1.0.0..HEAD',
      repoUrl: 'https://github.com/acme/my-lib',
      date: '2026-01-15',
      entries: [{ type: 'fixed', description: 'respect refs', prNumber: '#10', issueIds: ['#10', '#3', '#12'] }],
    },
  ],
};

describe('Pipeline: PR context', () => {
  let tmpDir: string;
  const prompts: string[] = [];

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'releasekit-pr-context-'));
    prompts.length = 0;
    vi.stubEnv('GITHUB_TOKEN', 'token');
    const { createProvider } = await import('../../src/llm/index.js');
    vi.mocked(createProvider).mockReturnValue({
      name: 'stub',
      capabilities: { systemRole: true, structuredOutputs: false, toolUse: false },
      async complete(messages: LLMMessage[]): Promise<CompleteResult> {
        const user = messages.at(-1)?.content ?? '';
        prompts.push(user);
        return { content: 'Fixed refs' };
      },
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should give the LLM the entry's own PR, not other PRs its closing refs name", async () => {
    await runPipeline(
      input,
      {
        changelog: false,
        releaseNotes: {
          file: { dir: tmpDir },
          llm: { provider: 'openai', model: 'stub', examples: 0, tasks: { enhance: true } },
        },
      },
      false,
    );

    const prompt = prompts.join('\n');
    expect(prompt).toContain('<pr number="10"');
    expect(prompt).toContain('Own PR body');
    expect(prompt).not.toContain('<pr number="3"');
    expect(prompt).not.toContain('Upstream release notes');
  });
});
