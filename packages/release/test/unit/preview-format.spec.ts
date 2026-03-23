import type { VersionOutput } from '@releasekit/core';
import { describe, expect, it } from 'vitest';
import { formatPreviewComment } from '../../src/preview-format.js';
import type { ReleaseOutput } from '../../src/types.js';

const versionOutput: VersionOutput = {
  dryRun: true,
  updates: [
    { packageName: '@releasekit/version', newVersion: '0.3.1', filePath: 'packages/version/package.json' },
    { packageName: '@releasekit/notes', newVersion: '0.3.1', filePath: 'packages/notes/package.json' },
  ],
  changelogs: [
    {
      packageName: '@releasekit/version',
      version: '0.3.1',
      previousVersion: '0.3.0',
      revisionRange: 'v0.3.0..HEAD',
      repoUrl: 'https://github.com/goosewobbler/releasekit',
      entries: [
        { type: 'added', description: 'New dry-run flag', scope: 'cli' },
        { type: 'fixed', description: 'Fix prerelease sorting', scope: 'semver', issueIds: ['#42'] },
        { type: 'chore', description: 'Migrate to Vitest' },
      ],
    },
    {
      packageName: '@releasekit/notes',
      version: '0.3.1',
      previousVersion: '0.3.0',
      revisionRange: 'v0.3.0..HEAD',
      repoUrl: 'https://github.com/goosewobbler/releasekit',
      entries: [{ type: 'added', description: 'LLM-powered release notes', scope: 'llm' }],
    },
  ],
  commitMessage: 'chore(release): 0.3.1',
  tags: ['@releasekit/version@v0.3.1', '@releasekit/notes@v0.3.1'],
};

const releaseOutput: ReleaseOutput = {
  versionOutput,
  notesGenerated: true,
};

describe('formatPreviewComment', () => {
  it('includes marker comment at the top', () => {
    const result = formatPreviewComment(releaseOutput);
    expect(result.startsWith('<!-- releasekit-preview -->')).toBe(true);
  });

  it('includes package table', () => {
    const result = formatPreviewComment(releaseOutput);
    expect(result).toContain('| `@releasekit/version` | 0.3.1 |');
    expect(result).toContain('| `@releasekit/notes` | 0.3.1 |');
  });

  it('includes changelog with entry grouping by type', () => {
    const result = formatPreviewComment(releaseOutput);
    expect(result).toContain('#### Added');
    expect(result).toContain('- New dry-run flag (`cli`)');
    expect(result).toContain('#### Fixed');
    expect(result).toContain('- Fix prerelease sorting (`semver`) #42');
    expect(result).toContain('#### Chores');
    expect(result).toContain('- Migrate to Vitest');
  });

  it('wraps each package changelog in details element', () => {
    const result = formatPreviewComment(releaseOutput);
    expect(result).toContain('<details>');
    expect(result).toContain('<b>@releasekit/version</b> 0.3.0 → 0.3.1');
    expect(result).toContain('<b>@releasekit/notes</b> 0.3.0 → 0.3.1');
    expect(result).toContain('</details>');
  });

  it('includes tags', () => {
    const result = formatPreviewComment(releaseOutput);
    expect(result).toContain('- `@releasekit/version@v0.3.1`');
    expect(result).toContain('- `@releasekit/notes@v0.3.1`');
  });

  it('includes footer', () => {
    const result = formatPreviewComment(releaseOutput);
    expect(result).toContain('Updated automatically by [ReleaseKit]');
  });

  it('shows no-changes message when result is null', () => {
    const result = formatPreviewComment(null);
    expect(result).toContain('<!-- releasekit-preview -->');
    expect(result).toContain('No releasable changes detected');
    expect(result).toContain('[!NOTE]');
    expect(result).not.toContain('### Packages');
  });

  it('handles single package without changelogs', () => {
    const output: ReleaseOutput = {
      versionOutput: {
        dryRun: true,
        updates: [{ packageName: 'my-lib', newVersion: '1.0.0', filePath: 'package.json' }],
        changelogs: [],
        tags: ['v1.0.0'],
      },
      notesGenerated: false,
    };

    const result = formatPreviewComment(output);
    expect(result).toContain('| `my-lib` | 1.0.0 |');
    expect(result).not.toContain('### Changelog');
    expect(result).toContain('- `v1.0.0`');
  });

  it('handles entries with unknown types', () => {
    const output: ReleaseOutput = {
      versionOutput: {
        dryRun: true,
        updates: [{ packageName: 'pkg', newVersion: '1.0.0', filePath: 'package.json' }],
        changelogs: [
          {
            packageName: 'pkg',
            version: '1.0.0',
            previousVersion: '0.9.0',
            revisionRange: 'v0.9.0..HEAD',
            repoUrl: null,
            entries: [{ type: 'custom', description: 'Something custom' }],
          },
        ],
        tags: [],
      },
      notesGenerated: false,
    };

    const result = formatPreviewComment(output);
    expect(result).toContain('#### Custom');
    expect(result).toContain('- Something custom');
  });

  it('handles null previousVersion', () => {
    const output: ReleaseOutput = {
      versionOutput: {
        dryRun: true,
        updates: [{ packageName: 'new-pkg', newVersion: '1.0.0', filePath: 'package.json' }],
        changelogs: [
          {
            packageName: 'new-pkg',
            version: '1.0.0',
            previousVersion: null,
            revisionRange: 'HEAD',
            repoUrl: null,
            entries: [{ type: 'added', description: 'Initial release' }],
          },
        ],
        tags: ['v1.0.0'],
      },
      notesGenerated: false,
    };

    const result = formatPreviewComment(output);
    expect(result).toContain('N/A → 1.0.0');
  });
});
