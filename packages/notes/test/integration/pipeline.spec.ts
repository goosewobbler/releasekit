import { describe, expect, it } from 'vitest';
import { createDocumentContext, createTemplateContext } from '../../src/core/pipeline.js';
import { parseVersionOutput } from '../../src/input/version-output.js';
import { aggregateToRoot } from '../../src/monorepo/aggregator.js';
import { splitByPackage } from '../../src/monorepo/splitter.js';
import { formatVersion, renderMarkdown } from '../../src/output/markdown.js';

const versionOutputFixture = {
  dryRun: false,
  updates: [{ packageName: 'my-lib', newVersion: '2.0.0', filePath: 'package.json' }],
  changelogs: [
    {
      packageName: 'my-lib',
      version: '2.0.0',
      previousVersion: 'v1.0.0',
      revisionRange: 'v1.0.0..HEAD',
      repoUrl: 'https://github.com/acme/my-lib',
      entries: [
        { type: 'feat', description: 'Add streaming support', scope: 'api' },
        { type: 'fix', description: 'Null pointer in parser', issueIds: ['#88'] },
        { type: 'refactor', description: 'Simplify config loading' },
      ],
    },
  ],
  tags: ['v2.0.0'],
};

describe('Pipeline: version output → markdown', () => {
  it('should produce a valid changelog with version header', () => {
    const input = parseVersionOutput(JSON.stringify(versionOutputFixture));
    const contexts = input.packages.map(createTemplateContext);
    const markdown = renderMarkdown(contexts);

    expect(markdown).toContain('# Changelog');
    expect(markdown).toContain('## [2.0.0]');
    expect(markdown).toContain('### Added');
    expect(markdown).toContain('- **api**: Add streaming support');
    expect(markdown).toContain('### Fixed');
    // Bare `#88` is rendered as a canonical Markdown link by default (link mode).
    expect(markdown).toContain('- Null pointer in parser ([#88](https://github.com/acme/my-lib/issues/88))');
    expect(markdown).toContain('### Changed');
    expect(markdown).toContain('- Simplify config loading');
  });

  it('should include a GitHub comparison link', () => {
    const input = parseVersionOutput(JSON.stringify(versionOutputFixture));
    const contexts = input.packages.map(createTemplateContext);
    const markdown = renderMarkdown(contexts);

    expect(markdown).toContain('[Full Changelog](https://github.com/acme/my-lib/compare/v1.0.0...v2.0.0)');
  });

  it('should link to the tag the changelog records', () => {
    const input = parseVersionOutput(
      JSON.stringify({
        ...versionOutputFixture,
        changelogs: [{ ...versionOutputFixture.changelogs[0], previousVersion: 'my-lib/1.0.0', tag: 'my-lib/2.0.0' }],
        tags: ['other/1.0.0', 'my-lib/2.0.0'],
      }),
    );
    const [ctx] = input.packages.map(createTemplateContext);

    expect(ctx?.compareUrl).toBe('https://github.com/acme/my-lib/compare/my-lib/1.0.0...my-lib/2.0.0');
  });

  it.each([
    [
      "the update's tag",
      { updates: [{ packageName: 'my-lib', newVersion: '2.0.0', filePath: 'package.json', tag: 'my-lib/2.0.0' }] },
    ],
    ['the only tag when there are no updates', { updates: undefined }],
  ])('should fall back to %s for older version output', (_, extra) => {
    const input = parseVersionOutput(
      JSON.stringify({
        ...versionOutputFixture,
        ...extra,
        changelogs: [{ ...versionOutputFixture.changelogs[0], previousVersion: 'my-lib/1.0.0' }],
        tags: ['my-lib/2.0.0'],
      }),
    );
    const [ctx] = input.packages.map(createTemplateContext);

    expect(ctx?.compareUrl).toBe('https://github.com/acme/my-lib/compare/my-lib/1.0.0...my-lib/2.0.0');
  });

  it('should populate compareUrls in document context', () => {
    const input = parseVersionOutput(JSON.stringify(versionOutputFixture));
    const contexts = input.packages.map(createTemplateContext);
    const doc = createDocumentContext(contexts, 'https://github.com/acme/my-lib');

    expect(doc.compareUrls).toBeDefined();
    expect(doc.compareUrls?.['2.0.0']).toBe('https://github.com/acme/my-lib/compare/v1.0.0...v2.0.0');
  });
});

describe('compareUrl: platform detection', () => {
  function makeCtx(repoUrl: string, previousVersion = 'v1.0.0') {
    return createTemplateContext({
      packageName: 'pkg',
      version: '2.0.0',
      previousVersion,
      revisionRange: `${previousVersion}..HEAD`,
      repoUrl,
      date: '2026-01-01',
      entries: [],
    });
  }

  it('should generate GitHub compare URL', () => {
    const ctx = makeCtx('https://github.com/org/repo');
    expect(ctx.compareUrl).toBe('https://github.com/org/repo/compare/v1.0.0...v2.0.0');
  });

  it('should generate GitLab compare URL', () => {
    const ctx = makeCtx('https://gitlab.com/org/repo');
    expect(ctx.compareUrl).toBe('https://gitlab.com/org/repo/-/compare/v1.0.0...v2.0.0');
  });

  it('should generate Bitbucket compare URL', () => {
    const ctx = makeCtx('https://bitbucket.org/org/repo');
    expect(ctx.compareUrl).toBe('https://bitbucket.org/org/repo/branches/compare/v1.0.0..v2.0.0');
  });

  it('should keep unprefixed tags unprefixed', () => {
    expect(makeCtx('https://github.com/org/repo', '1.0.0').compareUrl).toBe(
      'https://github.com/org/repo/compare/1.0.0...2.0.0',
    );
    expect(makeCtx('https://gitlab.com/org/repo', '1.0.0').compareUrl).toBe(
      'https://gitlab.com/org/repo/-/compare/1.0.0...2.0.0',
    );
    expect(makeCtx('https://bitbucket.org/org/repo', '1.0.0').compareUrl).toBe(
      'https://bitbucket.org/org/repo/branches/compare/1.0.0..2.0.0',
    );
  });

  it('should generate compare URL for package-specific version tags', () => {
    const ctx = createTemplateContext({
      packageName: '@releasekit/version',
      version: '0.2.0-next.9',
      previousVersion: '@releasekit/version@v0.2.0-next.8',
      revisionRange: '@releasekit/version@v0.2.0-next.8..HEAD',
      repoUrl: 'https://github.com/goosewobbler/releasekit',
      date: '2026-01-01',
      entries: [],
    });
    expect(ctx.compareUrl).toBe(
      'https://github.com/goosewobbler/releasekit/compare/@releasekit/version@v0.2.0-next.8...@releasekit/version@v0.2.0-next.9',
    );
  });

  it('should generate compare URL for dash-format package-specific tags (sync mode)', () => {
    const ctx = createTemplateContext({
      packageName: '@releasekit/version',
      version: '0.6.0',
      previousVersion: 'releasekit-version-v0.5.0',
      revisionRange: 'releasekit-version-v0.5.0..HEAD',
      repoUrl: 'https://github.com/goosewobbler/releasekit',
      date: '2026-01-01',
      entries: [],
    });
    expect(ctx.compareUrl).toBe(
      'https://github.com/goosewobbler/releasekit/compare/releasekit-version-v0.5.0...releasekit-version-v0.6.0',
    );
  });

  it('should generate compare URL for dash-format pre-release tags without v prefix', () => {
    const ctx = createTemplateContext({
      packageName: '@releasekit/notes',
      version: '0.3.0-next.2',
      previousVersion: 'releasekit-notes-0.3.0-next.1',
      revisionRange: 'releasekit-notes-0.3.0-next.1..HEAD',
      repoUrl: 'https://github.com/goosewobbler/releasekit',
      date: '2026-01-01',
      entries: [],
    });
    expect(ctx.compareUrl).toBe(
      'https://github.com/goosewobbler/releasekit/compare/releasekit-notes-0.3.0-next.1...releasekit-notes-0.3.0-next.2',
    );
  });

  it('should generate compare URL for sanitized "@v" package-specific tags', () => {
    const ctx = createTemplateContext({
      packageName: '@zubridge/electron',
      version: '3.1.0',
      previousVersion: 'zubridge-electron@v3.0.0',
      revisionRange: 'zubridge-electron@v3.0.0..HEAD',
      repoUrl: 'https://github.com/goosewobbler/zubridge',
      date: '2026-01-01',
      entries: [],
    });
    expect(ctx.compareUrl).toBe(
      'https://github.com/goosewobbler/zubridge/compare/zubridge-electron@v3.0.0...zubridge-electron@v3.1.0',
    );
  });

  it('should generate compare URL for sanitized "@v" tags across a prerelease escalation', () => {
    const ctx = createTemplateContext({
      packageName: '@zubridge/tauri',
      version: '2.0.0-next.0',
      previousVersion: 'zubridge-tauri@v1.1.1-next.1',
      revisionRange: 'zubridge-tauri@v1.1.1-next.1..HEAD',
      repoUrl: 'https://github.com/goosewobbler/zubridge',
      date: '2026-01-01',
      entries: [],
    });
    expect(ctx.compareUrl).toBe(
      'https://github.com/goosewobbler/zubridge/compare/zubridge-tauri@v1.1.1-next.1...zubridge-tauri@v2.0.0-next.0',
    );
  });

  it('should omit compareUrl when no previousVersion', () => {
    const ctx = createTemplateContext({
      packageName: 'pkg',
      version: '1.0.0',
      previousVersion: null,
      revisionRange: 'HEAD',
      repoUrl: 'https://github.com/org/repo',
      date: '2026-01-01',
      entries: [],
    });
    expect(ctx.compareUrl).toBeUndefined();
  });
});

describe('Monorepo: aggregation and splitting', () => {
  const pkgA = createTemplateContext({
    packageName: '@acme/core',
    version: '1.0.0',
    previousVersion: null,
    revisionRange: 'HEAD',
    repoUrl: null,
    date: '2026-01-01',
    entries: [{ type: 'added', description: 'Core init' }],
  });

  const pkgB = createTemplateContext({
    packageName: '@acme/ui',
    version: '1.0.0',
    previousVersion: null,
    revisionRange: 'HEAD',
    repoUrl: null,
    date: '2026-01-01',
    entries: [{ type: 'fixed', description: 'Button alignment' }],
  });

  it('should aggregate all entries into a root context', () => {
    const root = aggregateToRoot([pkgA, pkgB]);
    expect(root.packageName).toBe('monorepo');
    expect(root.entries).toHaveLength(2);
    expect(root.entries.some((e) => e.scope?.includes('@acme/core'))).toBe(true);
    expect(root.entries.some((e) => e.scope?.includes('@acme/ui'))).toBe(true);
  });

  it('should split into per-package map', () => {
    const map = splitByPackage([pkgA, pkgB]);
    expect(map.size).toBe(2);
    expect(map.get('@acme/core')).toBe(pkgA);
    expect(map.get('@acme/ui')).toBe(pkgB);
  });

  it('should have aggregated markdown contain both package scopes', () => {
    const root = aggregateToRoot([pkgA, pkgB]);
    const markdown = renderMarkdown([root]);
    expect(markdown).toContain('@acme/core');
    expect(markdown).toContain('@acme/ui');
  });

  it('should render root changelog with per-package sections with package names in headers', () => {
    const markdown = renderMarkdown([pkgA, pkgB], { includePackageName: true });

    expect(markdown).toContain('## @acme/core@1.0.0');
    expect(markdown).toContain('## @acme/ui@1.0.0');
    expect(markdown).toContain('- Core init');
    expect(markdown).toContain('- Button alignment');
  });

  it('should omit package name from headers in per-package changelogs', () => {
    const markdown = renderMarkdown([pkgA]);

    expect(markdown).toContain('## 1.0.0');
    expect(markdown).not.toContain('@acme/core@');
  });

  it('should include package name in formatVersion only when requested', () => {
    // firstRelease disabled to isolate the includePackageName behaviour from the first-release intro,
    // whose line legitimately names the package.
    const withName = formatVersion(pkgA, { includePackageName: true, firstRelease: false });
    const withoutName = formatVersion(pkgA, { firstRelease: false });

    expect(withName).toContain('## @acme/core@1.0.0');
    expect(withoutName).toContain('## 1.0.0');
    expect(withoutName).not.toContain('@acme/core');
  });

  it('should use bracketed headers in root changelog with previousVersion', () => {
    const pkgWithPrev = createTemplateContext({
      packageName: '@acme/core',
      version: '2.0.0',
      previousVersion: 'v1.0.0',
      revisionRange: 'v1.0.0..HEAD',
      repoUrl: null,
      date: '2026-02-01',
      entries: [{ type: 'added', description: 'New feature' }],
    });

    const markdown = renderMarkdown([pkgWithPrev], { includePackageName: true });
    expect(markdown).toContain('## [@acme/core@2.0.0]');
  });
});
