import { describe, expect, it } from 'vitest';
import { createTemplateContext } from '../../src/core/pipeline.js';
import { parsePackageVersioner } from '../../src/input/package-versioner.js';
import { renderMarkdown } from '../../src/output/markdown.js';

const sampleInput = {
  dryRun: false,
  updates: [{ packageName: 'test-pkg', newVersion: '1.0.0', filePath: 'package.json' }],
  changelogs: [
    {
      packageName: 'test-pkg',
      version: '1.0.0',
      previousVersion: null,
      revisionRange: 'HEAD',
      repoUrl: 'https://github.com/test/test-pkg',
      entries: [
        { type: 'added', description: 'New feature' },
        { type: 'fixed', description: 'Fixed bug', scope: 'core' },
      ],
    },
  ],
  tags: ['v1.0.0'],
};

describe('Input Parser', () => {
  it('should parse package-versioner JSON', () => {
    const result = parsePackageVersioner(JSON.stringify(sampleInput));

    expect(result.source).toBe('package-versioner');
    expect(result.packages).toHaveLength(1);
    expect(result.packages[0]?.packageName).toBe('test-pkg');
    expect(result.packages[0]?.entries).toHaveLength(2);
  });

  it('should normalize entry types', () => {
    const input = {
      ...sampleInput,
      changelogs: [
        {
          ...(sampleInput.changelogs[0] ?? {}),
          entries: [
            { type: 'feat', description: 'New feature' },
            { type: 'fix', description: 'Bug fix' },
          ],
        },
      ],
    };

    const result = parsePackageVersioner(JSON.stringify(input));

    expect(result.packages[0]?.entries[0]?.type).toBe('added');
    expect(result.packages[0]?.entries[1]?.type).toBe('fixed');
  });

  it('should throw on invalid JSON', () => {
    expect(() => parsePackageVersioner('not json')).toThrow();
  });

  it('should throw on missing changelogs', () => {
    expect(() => parsePackageVersioner(JSON.stringify({}))).toThrow('changelogs');
  });
});

describe('Markdown Output', () => {
  it('should render markdown from template context', () => {
    const input = parsePackageVersioner(JSON.stringify(sampleInput));
    const contexts = input.packages.map(createTemplateContext);
    const markdown = renderMarkdown(contexts);

    expect(markdown).toContain('# Changelog');
    expect(markdown).toContain('## 1.0.0');
    expect(markdown).toContain('### Added');
    expect(markdown).toContain('### Fixed');
    expect(markdown).toContain('- New feature');
    expect(markdown).toContain('- **core**: Fixed bug');
  });

  it('should include comparison links when available', () => {
    const inputWithPrev = {
      ...sampleInput,
      changelogs: [
        {
          ...(sampleInput.changelogs[0] ?? {}),
          version: '1.1.0',
          previousVersion: 'v1.0.0',
        },
      ],
    };

    const input = parsePackageVersioner(JSON.stringify(inputWithPrev));
    const contexts = input.packages.map(createTemplateContext);
    const markdown = renderMarkdown(contexts);

    expect(markdown).toContain('[Full Changelog]');
    expect(markdown).toContain('/compare/1.0.0...1.1.0');
  });

  it('should include full package-specific tag in comparison link', () => {
    const inputWithPrev = {
      ...sampleInput,
      changelogs: [
        {
          ...(sampleInput.changelogs[0] ?? {}),
          packageName: '@releasekit/version',
          version: '0.2.0-next.9',
          previousVersion: '@releasekit/version@v0.2.0-next.8',
        },
      ],
    };

    const input = parsePackageVersioner(JSON.stringify(inputWithPrev));
    const contexts = input.packages.map(createTemplateContext);
    const markdown = renderMarkdown(contexts);

    expect(markdown).toContain('[Full Changelog]');
    expect(markdown).toContain('/compare/@releasekit/version@v0.2.0-next.8...@releasekit/version@v0.2.0-next.9');
  });
});
