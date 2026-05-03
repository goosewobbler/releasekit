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

const minimalConfig: Config = {};

describe('writeMarkdown: dry run', () => {
  let info: ReturnType<typeof vi.fn>;
  let debug: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const core = await import('@releasekit/core');
    info = vi.mocked(core.info);
    debug = vi.mocked(core.debug);
  });

  it('should log content via info() during dry run', async () => {
    const { writeMarkdown } = await import('../../../src/output/markdown.js');

    writeMarkdown('/tmp/CHANGELOG.md', [makeContext()], minimalConfig, true);

    expect(info).toHaveBeenCalled();
    const calls = info.mock.calls.map((c) => c[0] as string);
    const hasContent = calls.some((msg) => msg.includes('### Added'));
    expect(hasContent).toBe(true);
  });

  it('should not call debug() for content during dry run', async () => {
    const { writeMarkdown } = await import('../../../src/output/markdown.js');

    writeMarkdown('/tmp/CHANGELOG.md', [makeContext()], minimalConfig, true);

    expect(debug).not.toHaveBeenCalled();
  });

  it('should label the preview using the output filename', async () => {
    const { writeMarkdown } = await import('../../../src/output/markdown.js');

    writeMarkdown('/tmp/CHANGELOG.md', [makeContext()], minimalConfig, true);

    const calls = info.mock.calls.map((c) => c[0] as string);
    const header = calls.find((msg) => msg.includes('DRY RUN'));
    expect(header).toMatch(/CHANGELOG\.md/);
  });

  it('should use "Release notes" label for non-changelog output files', async () => {
    const { writeMarkdown } = await import('../../../src/output/markdown.js');

    writeMarkdown('/tmp/RELEASE_NOTES.md', [makeContext()], minimalConfig, true);

    const calls = info.mock.calls.map((c) => c[0] as string);
    const header = calls.find((msg) => msg.includes('DRY RUN'));
    expect(header).toMatch(/Release notes/i);
  });
});

// ---------------------------------------------------------------------------
// formatVersion — leadIn rendering
// ---------------------------------------------------------------------------

describe('formatVersion: leadIn phrases', () => {
  it('should render bold leadIn prefix when present', async () => {
    const { formatVersion } = await import('../../../src/output/markdown.js');

    const ctx = makeContext({
      enhanced: {
        categories: [{ name: 'New', entries: [{ type: 'added', description: 'New API', leadIn: 'deeplink' }] }],
      },
    });

    const result = formatVersion(ctx);
    expect(result).toContain('- **deeplink**: New API');
  });

  it('should fall back to plain description when leadIn is absent', async () => {
    const { formatVersion } = await import('../../../src/output/markdown.js');

    const ctx = makeContext({
      enhanced: {
        categories: [{ name: 'Fixed', entries: [{ type: 'fixed', description: 'Fix bug' }] }],
      },
    });

    const result = formatVersion(ctx);
    expect(result).toContain('- Fix bug');
    expect(result).not.toContain('**');
  });
});

// ---------------------------------------------------------------------------
// formatVersion — scope grouping
// ---------------------------------------------------------------------------

describe('formatVersion: scope grouping', () => {
  it('should group multiple entries with the same scope under a bold scope header', async () => {
    const { formatVersion } = await import('../../../src/output/markdown.js');

    const ctx = makeContext({
      enhanced: {
        categories: [
          {
            name: 'New',
            entries: [
              { type: 'added', description: 'Feature A', scope: 'api' },
              { type: 'added', description: 'Feature B', scope: 'api' },
            ],
          },
        ],
      },
    });

    const result = formatVersion(ctx);
    expect(result).toContain('**api**:');
    // Individual entries should NOT repeat the scope prefix
    expect(result).not.toContain('**api**: Feature A');
    expect(result).toContain('- Feature A');
    expect(result).toContain('- Feature B');
  });

  it('should not create a scope group header for a single entry with that scope', async () => {
    const { formatVersion } = await import('../../../src/output/markdown.js');

    const ctx = makeContext({
      enhanced: {
        categories: [
          {
            name: 'Fixed',
            entries: [
              { type: 'fixed', description: 'Fix A', scope: 'core' },
              { type: 'fixed', description: 'Fix B', scope: 'ui' },
            ],
          },
        ],
      },
    });

    const result = formatVersion(ctx);
    // Group headers appear on their own line (not prefixed with '-')
    expect(result).not.toMatch(/^\*\*core\*\*:/m);
    expect(result).not.toMatch(/^\*\*ui\*\*:/m);
    // Scope still appears inline in the entry
    expect(result).toContain('**core**: Fix A');
    expect(result).toContain('**ui**: Fix B');
  });

  it('should render ungrouped entries after scoped groups', async () => {
    const { formatVersion } = await import('../../../src/output/markdown.js');

    const ctx = makeContext({
      enhanced: {
        categories: [
          {
            name: 'New',
            entries: [
              { type: 'added', description: 'Scoped 1', scope: 'api' },
              { type: 'added', description: 'Scoped 2', scope: 'api' },
              { type: 'added', description: 'No scope' },
            ],
          },
        ],
      },
    });

    const result = formatVersion(ctx);
    const apiPos = result.indexOf('**api**:');
    const noScopePos = result.indexOf('- No scope');
    expect(apiPos).toBeLessThan(noScopePos);
  });
});

// ---------------------------------------------------------------------------
// formatVersion — breaking changes re-routing
// ---------------------------------------------------------------------------

describe('formatVersion: breaking changes section', () => {
  it('should route breaking entries into the Breaking category', async () => {
    const { formatVersion } = await import('../../../src/output/markdown.js');

    const ctx = makeContext({
      enhanced: {
        categories: [
          {
            name: 'Changed',
            entries: [
              { type: 'changed', description: 'Breaking change', breaking: true },
              { type: 'changed', description: 'Normal change' },
            ],
          },
        ],
      },
    });

    const result = formatVersion(ctx);
    const breakingPos = result.indexOf('### Breaking');
    const changedPos = result.indexOf('### Changed');
    expect(breakingPos).toBeGreaterThanOrEqual(0);
    expect(breakingPos).toBeLessThan(changedPos);
    expect(result).toContain('- **BREAKING** Breaking change');
  });

  it('should not render a Breaking section when no entries have breaking: true', async () => {
    const { formatVersion } = await import('../../../src/output/markdown.js');

    const ctx = makeContext({
      enhanced: {
        categories: [{ name: 'New', entries: [{ type: 'added', description: 'Feature' }] }],
      },
    });

    expect(formatVersion(ctx)).not.toContain('### Breaking');
  });

  it('should render Breaking section first when categoryOrder includes Breaking', async () => {
    const { formatVersion } = await import('../../../src/output/markdown.js');

    const ctx = makeContext({
      enhanced: {
        categories: [
          { name: 'New', entries: [{ type: 'added', description: 'Feature' }] },
          { name: 'Changed', entries: [{ type: 'changed', description: 'Breaking thing', breaking: true }] },
        ],
      },
    });

    const result = formatVersion(ctx, { categoryOrder: ['Breaking', 'New', 'Changed'] });
    const breakingPos = result.indexOf('### Breaking');
    const newPos = result.indexOf('### New');
    expect(breakingPos).toBeLessThan(newPos);
  });
});

// ---------------------------------------------------------------------------
// formatVersion — categoryOrder
// ---------------------------------------------------------------------------

describe('formatVersion: categoryOrder', () => {
  it('should sort categories according to provided order', async () => {
    const { formatVersion } = await import('../../../src/output/markdown.js');

    const ctx = makeContext({
      enhanced: {
        categories: [
          { name: 'Fixed', entries: [{ type: 'fixed', description: 'Fix' }] },
          { name: 'New', entries: [{ type: 'added', description: 'Feature' }] },
        ],
      },
    });

    const result = formatVersion(ctx, { categoryOrder: ['New', 'Fixed'] });
    expect(result.indexOf('### New')).toBeLessThan(result.indexOf('### Fixed'));
  });

  it('should append categories not in categoryOrder at the end', async () => {
    const { formatVersion } = await import('../../../src/output/markdown.js');

    const ctx = makeContext({
      enhanced: {
        categories: [
          { name: 'Unknown', entries: [{ type: 'changed', description: 'Unknown change' }] },
          { name: 'New', entries: [{ type: 'added', description: 'Feature' }] },
        ],
      },
    });

    const result = formatVersion(ctx, { categoryOrder: ['New'] });
    expect(result.indexOf('### New')).toBeLessThan(result.indexOf('### Unknown'));
  });
});

// ---------------------------------------------------------------------------
// formatVersion — migration links
// ---------------------------------------------------------------------------

describe('formatVersion: migration links', () => {
  it('should render explicit link items under ### Links by default', async () => {
    const { formatVersion } = await import('../../../src/output/markdown.js');

    const ctx = makeContext({
      enhanced: {
        categories: [{ name: 'New', entries: [{ type: 'added', description: 'Feature' }] }],
      },
    });

    const result = formatVersion(ctx, {
      links: { items: [{ label: 'Migration guide', url: 'https://example.com/migrate' }] },
    });

    expect(result).toContain('### Links');
    expect(result).toContain('- [Migration guide](https://example.com/migrate)');
  });

  it('should use custom title when links.title is set', async () => {
    const { formatVersion } = await import('../../../src/output/markdown.js');

    const ctx = makeContext({
      enhanced: {
        categories: [{ name: 'New', entries: [{ type: 'added', description: 'Feature' }] }],
      },
    });

    const result = formatVersion(ctx, {
      links: { title: 'Migration', items: [{ label: 'Guide', url: 'https://example.com/guide' }] },
    });

    expect(result).toContain('### Migration');
  });

  it('should discover links from PR body marker', async () => {
    const { formatVersion } = await import('../../../src/output/markdown.js');

    const ctx = makeContext({
      entries: [
        {
          type: 'changed' as const,
          description: 'Breaking change',
          context: {
            prs: [{ number: 1, title: 'PR', body: 'Migration: https://example.com/guide' }],
          },
        },
      ],
      enhanced: {
        categories: [{ name: 'Changed', entries: [{ type: 'changed', description: 'Breaking change' }] }],
      },
    });

    const result = formatVersion(ctx, { links: { fromPRBodyMarker: 'Migration:' } });
    expect(result).toContain('### Links');
    expect(result).toContain('https://example.com/guide');
  });

  it('should discover markdown links from PR body marker', async () => {
    const { formatVersion } = await import('../../../src/output/markdown.js');

    const ctx = makeContext({
      entries: [
        {
          type: 'changed' as const,
          description: 'Change',
          context: {
            prs: [
              {
                number: 2,
                title: 'PR',
                body: 'Migration: [Full guide](https://example.com/full-guide)',
              },
            ],
          },
        },
      ],
      enhanced: {
        categories: [{ name: 'Changed', entries: [{ type: 'changed', description: 'Change' }] }],
      },
    });

    const result = formatVersion(ctx, { links: { fromPRBodyMarker: 'Migration:' } });
    expect(result).toContain('- [Full guide](https://example.com/full-guide)');
  });

  it('should deduplicate links by URL', async () => {
    const { formatVersion } = await import('../../../src/output/markdown.js');

    const ctx = makeContext({
      entries: [
        {
          type: 'changed' as const,
          description: 'Change',
          context: {
            prs: [{ number: 3, title: 'PR', body: 'Migration: https://example.com/guide' }],
          },
        },
      ],
      enhanced: {
        categories: [{ name: 'Changed', entries: [{ type: 'changed', description: 'Change' }] }],
      },
    });

    const result = formatVersion(ctx, {
      links: {
        items: [{ label: 'guide', url: 'https://example.com/guide' }],
        fromPRBodyMarker: 'Migration:',
      },
    });

    const count = (result.match(/https:\/\/example\.com\/guide/g) ?? []).length;
    expect(count).toBe(1);
  });

  it('should not render links section when no links found', async () => {
    const { formatVersion } = await import('../../../src/output/markdown.js');

    const ctx = makeContext({
      enhanced: {
        categories: [{ name: 'New', entries: [{ type: 'added', description: 'Feature' }] }],
      },
    });

    expect(formatVersion(ctx)).not.toContain('### Links');
  });

  it('should not render links section in non-LLM path', async () => {
    const { formatVersion } = await import('../../../src/output/markdown.js');

    // No enhanced.categories → type-based path
    const ctx = makeContext();
    const result = formatVersion(ctx, {
      links: { items: [{ label: 'guide', url: 'https://example.com/guide' }] },
    });

    expect(result).not.toContain('### Links');
  });
});

// ---------------------------------------------------------------------------
// formatVersion — non-LLM path unchanged
// ---------------------------------------------------------------------------

describe('formatVersion: non-LLM path', () => {
  it('should use type-based grouping when no enhanced categories', async () => {
    const { formatVersion } = await import('../../../src/output/markdown.js');

    const ctx = makeContext({
      entries: [
        { type: 'added', description: 'Feature' },
        { type: 'fixed', description: 'Bug fix' },
      ],
    });

    const result = formatVersion(ctx);
    expect(result).toContain('### Added');
    expect(result).toContain('### Fixed');
  });
});
