import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Config, TemplateContext } from '../../../src/core/types.js';

vi.mock('@releasekit/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@releasekit/core')>();
  return { ...actual, info: vi.fn(), debug: vi.fn(), success: vi.fn() };
});

function makeContext(overrides: Partial<TemplateContext> = {}): TemplateContext {
  return {
    packageName: 'test-pkg',
    version: '1.0.0',
    previousVersion: '0.9.0',
    date: '2026-01-01',
    entries: [{ type: 'added', description: 'New feature' }],
    repoUrl: null,
    ...overrides,
  };
}

const minimalConfig: Config = {
  output: [{ format: 'markdown', file: 'CHANGELOG.md' }],
};

describe('writeMarkdown: dry run', () => {
  let info: ReturnType<typeof vi.fn>;
  let debug: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const core = await import('@releasekit/core');
    info = vi.mocked(core.info);
    debug = vi.mocked(core.debug);
  });

  it('logs content via info() during dry run', async () => {
    const { writeMarkdown } = await import('../../../src/output/markdown.js');

    writeMarkdown('/tmp/CHANGELOG.md', [makeContext()], minimalConfig, true);

    expect(info).toHaveBeenCalled();
    const calls = info.mock.calls.map((c) => c[0] as string);
    const hasContent = calls.some((msg) => msg.includes('### Added'));
    expect(hasContent).toBe(true);
  });

  it('does not call debug() for content during dry run', async () => {
    const { writeMarkdown } = await import('../../../src/output/markdown.js');

    writeMarkdown('/tmp/CHANGELOG.md', [makeContext()], minimalConfig, true);

    expect(debug).not.toHaveBeenCalled();
  });

  it('labels the preview using the output filename', async () => {
    const { writeMarkdown } = await import('../../../src/output/markdown.js');

    writeMarkdown('/tmp/CHANGELOG.md', [makeContext()], minimalConfig, true);

    const calls = info.mock.calls.map((c) => c[0] as string);
    const header = calls.find((msg) => msg.includes('DRY RUN'));
    expect(header).toMatch(/CHANGELOG\.md/);
  });

  it('uses "Release notes" label for non-changelog output files', async () => {
    const { writeMarkdown } = await import('../../../src/output/markdown.js');

    writeMarkdown('/tmp/RELEASE_NOTES.md', [makeContext()], minimalConfig, true);

    const calls = info.mock.calls.map((c) => c[0] as string);
    const header = calls.find((msg) => msg.includes('DRY RUN'));
    expect(header).toMatch(/Release notes/i);
  });
});
