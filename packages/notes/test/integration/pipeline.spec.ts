import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDocumentContext, createTemplateContext } from '../../src/core/pipeline.js';
import { parseConventionalChangelog, parseConventionalChangelogFile } from '../../src/input/conventional-changelog.js';
import { parsePackageVersioner } from '../../src/input/package-versioner.js';
import { aggregateToRoot, splitByPackage } from '../../src/monorepo/index.js';
import { renderMarkdown } from '../../src/output/markdown.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const packageVersionerFixture = {
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

const sampleChangelog = `
## [2.0.0] - 2026-01-15

### Added

- New plugin system
- **api**: Batch operations (#42)

### Fixed

- Memory leak (#38)

## [1.0.0] - 2025-09-15

### Added

- Initial release
`.trim();

// ---------------------------------------------------------------------------
// Full pipeline: package-versioner → markdown
// ---------------------------------------------------------------------------

describe('Pipeline: package-versioner → markdown', () => {
  it('produces a valid changelog with version header', () => {
    const input = parsePackageVersioner(JSON.stringify(packageVersionerFixture));
    const contexts = input.packages.map(createTemplateContext);
    const markdown = renderMarkdown(contexts);

    expect(markdown).toContain('# Changelog');
    expect(markdown).toContain('## [2.0.0]');
    expect(markdown).toContain('### Added');
    expect(markdown).toContain('- **api**: Add streaming support');
    expect(markdown).toContain('### Fixed');
    expect(markdown).toContain('- Null pointer in parser (#88)');
    expect(markdown).toContain('### Changed');
    expect(markdown).toContain('- Simplify config loading');
  });

  it('includes a GitHub comparison link', () => {
    const input = parsePackageVersioner(JSON.stringify(packageVersionerFixture));
    const contexts = input.packages.map(createTemplateContext);
    const markdown = renderMarkdown(contexts);

    expect(markdown).toContain('[Full Changelog](https://github.com/acme/my-lib/compare/v1.0.0...2.0.0)');
  });

  it('populates compareUrls in document context', () => {
    const input = parsePackageVersioner(JSON.stringify(packageVersionerFixture));
    const contexts = input.packages.map(createTemplateContext);
    const doc = createDocumentContext(contexts, 'https://github.com/acme/my-lib');

    expect(doc.compareUrls).toBeDefined();
    expect(doc.compareUrls?.['2.0.0']).toBe('https://github.com/acme/my-lib/compare/v1.0.0...2.0.0');
  });
});

// ---------------------------------------------------------------------------
// compareUrl generation by platform
// ---------------------------------------------------------------------------

describe('compareUrl: platform detection', () => {
  function makeCtx(repoUrl: string) {
    return createTemplateContext({
      packageName: 'pkg',
      version: '2.0.0',
      previousVersion: 'v1.0.0',
      revisionRange: 'v1.0.0..HEAD',
      repoUrl,
      date: '2026-01-01',
      entries: [],
    });
  }

  it('generates GitHub compare URL', () => {
    const ctx = makeCtx('https://github.com/org/repo');
    expect(ctx.compareUrl).toBe('https://github.com/org/repo/compare/v1.0.0...2.0.0');
  });

  it('generates GitLab compare URL', () => {
    const ctx = makeCtx('https://gitlab.com/org/repo');
    expect(ctx.compareUrl).toBe('https://gitlab.com/org/repo/-/compare/v1.0.0...2.0.0');
  });

  it('generates Bitbucket compare URL', () => {
    const ctx = makeCtx('https://bitbucket.org/org/repo');
    expect(ctx.compareUrl).toBe('https://bitbucket.org/org/repo/branches/compare/v1.0.0..2.0.0');
  });

  it('omits compareUrl when no previousVersion', () => {
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

// ---------------------------------------------------------------------------
// conventional-changelog parser
// ---------------------------------------------------------------------------

describe('Parser: conventional-changelog', () => {
  it('extracts all versions', () => {
    const result = parseConventionalChangelog(sampleChangelog, 'my-lib');
    expect(result.source).toBe('conventional-changelog');
    expect(result.packages).toHaveLength(2);
    expect(result.packages[0]?.version).toBe('2.0.0');
    expect(result.packages[1]?.version).toBe('1.0.0');
  });

  it('parses dates', () => {
    const result = parseConventionalChangelog(sampleChangelog, 'my-lib');
    expect(result.packages[0]?.date).toBe('2026-01-15');
    expect(result.packages[1]?.date).toBe('2025-09-15');
  });

  it('sets previousVersion from the next block', () => {
    const result = parseConventionalChangelog(sampleChangelog, 'my-lib');
    expect(result.packages[0]?.previousVersion).toBe('1.0.0');
    expect(result.packages[1]?.previousVersion).toBeNull();
  });

  it('normalises Added entries', () => {
    const result = parseConventionalChangelog(sampleChangelog, 'my-lib');
    const added = result.packages[0]?.entries.filter((e) => e.type === 'added') ?? [];
    expect(added.length).toBeGreaterThanOrEqual(1);
    expect(added.some((e) => e.description === 'New plugin system')).toBe(true);
  });

  it('extracts scope', () => {
    const result = parseConventionalChangelog(sampleChangelog, 'my-lib');
    const apiEntry = result.packages[0]?.entries.find((e) => e.scope === 'api');
    expect(apiEntry).toBeDefined();
    expect(apiEntry?.description).toBe('Batch operations');
  });

  it('extracts issue IDs', () => {
    const result = parseConventionalChangelog(sampleChangelog, 'my-lib');
    const fixedEntry = result.packages[0]?.entries.find((e) => e.type === 'fixed');
    expect(fixedEntry?.issueIds).toContain('#38');
  });

  it('round-trips: parse → render → contains version', () => {
    const result = parseConventionalChangelog(sampleChangelog, 'my-lib');
    const contexts = result.packages.map(createTemplateContext);
    const markdown = renderMarkdown(contexts);

    expect(markdown).toContain('## [2.0.0]');
    expect(markdown).toContain('## 1.0.0'); // no brackets: no previousVersion
    expect(markdown).toContain('New plugin system');
    expect(markdown).toContain('Initial release');
  });

  it('parses a real fixture file', () => {
    const fixturePath = path.join(process.cwd(), 'test', 'fixtures', 'sample-changelog.md');
    const result = parseConventionalChangelogFile(fixturePath, 'my-lib');
    expect(result.packages.length).toBeGreaterThanOrEqual(3);

    const v2 = result.packages.find((p) => p.version === '2.0.0');
    expect(v2).toBeDefined();
    expect(v2?.entries.some((e) => e.breaking)).toBe(true);
  });

  it('throws on empty content', () => {
    expect(() => parseConventionalChangelog('', 'pkg')).toThrow();
  });

  it('throws when no version headers found', () => {
    expect(() => parseConventionalChangelog('# Just a title\nSome text.', 'pkg')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Monorepo: aggregation and splitting
// ---------------------------------------------------------------------------

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

  it('aggregates all entries into a root context', () => {
    const root = aggregateToRoot([pkgA, pkgB]);
    expect(root.packageName).toBe('monorepo');
    expect(root.entries).toHaveLength(2);
    expect(root.entries.some((e) => e.scope?.includes('@acme/core'))).toBe(true);
    expect(root.entries.some((e) => e.scope?.includes('@acme/ui'))).toBe(true);
  });

  it('splits into per-package map', () => {
    const map = splitByPackage([pkgA, pkgB]);
    expect(map.size).toBe(2);
    expect(map.get('@acme/core')).toBe(pkgA);
    expect(map.get('@acme/ui')).toBe(pkgB);
  });

  it('aggregated markdown contains both package scopes', () => {
    const root = aggregateToRoot([pkgA, pkgB]);
    const markdown = renderMarkdown([root]);
    expect(markdown).toContain('@acme/core');
    expect(markdown).toContain('@acme/ui');
  });
});
