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

  it('wraps entire comment in a collapsed details element', () => {
    const result = formatPreviewComment(releaseOutput);
    expect(result).toContain('<details>');
    expect(result).toContain('<summary><b>Release Preview</b>');
    expect(result).toMatch(/<\/details>\s*$/);
  });

  it('shows package count in summary for multiple packages', () => {
    const result = formatPreviewComment(releaseOutput);
    expect(result).toContain('<summary><b>Release Preview</b> — 2 packages</summary>');
  });

  it('shows package name and version in summary for single package', () => {
    const singlePkg: ReleaseOutput = {
      versionOutput: {
        dryRun: true,
        updates: [{ packageName: 'my-lib', newVersion: '1.0.0', filePath: 'package.json' }],
        changelogs: [],
        tags: ['v1.0.0'],
      },
      notesGenerated: false,
    };
    const result = formatPreviewComment(singlePkg);
    expect(result).toContain('<summary><b>Release Preview</b> — my-lib 1.0.0</summary>');
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

  describe('shared entry deduplication', () => {
    const sharedEntry = { type: 'chore', description: 'Update CI pipeline' };
    const outputWithShared: ReleaseOutput = {
      versionOutput: {
        dryRun: true,
        updates: [
          { packageName: 'pkg-a', newVersion: '1.1.0', filePath: 'packages/a/package.json' },
          { packageName: 'pkg-b', newVersion: '1.1.0', filePath: 'packages/b/package.json' },
        ],
        changelogs: [
          {
            packageName: 'pkg-a',
            version: '1.1.0',
            previousVersion: '1.0.0',
            revisionRange: 'v1.0.0..HEAD',
            repoUrl: null,
            entries: [{ type: 'added', description: 'New feature in pkg-a' }, sharedEntry],
          },
          {
            packageName: 'pkg-b',
            version: '1.1.0',
            previousVersion: '1.0.0',
            revisionRange: 'v1.0.0..HEAD',
            repoUrl: null,
            entries: [{ type: 'fixed', description: 'Bug fix in pkg-b' }, sharedEntry],
          },
        ],
        tags: ['pkg-a@v1.1.0', 'pkg-b@v1.1.0'],
      },
      notesGenerated: false,
    };

    it('extracts shared entries into a Project-wide changes section', () => {
      const result = formatPreviewComment(outputWithShared);
      expect(result).toContain('<b>Project-wide changes</b>');
      expect(result).toContain('- Update CI pipeline');
    });

    it('removes shared entries from individual package changelogs', () => {
      const result = formatPreviewComment(outputWithShared);
      // Count occurrences — should appear once in shared, not again per package
      const occurrences = result.split('Update CI pipeline').length - 1;
      expect(occurrences).toBe(1);
    });

    it('keeps package-specific entries in each package changelog', () => {
      const result = formatPreviewComment(outputWithShared);
      expect(result).toContain('- New feature in pkg-a');
      expect(result).toContain('- Bug fix in pkg-b');
    });

    it('does not create a Project-wide section for single-package output', () => {
      const singlePkg: ReleaseOutput = {
        versionOutput: {
          dryRun: true,
          updates: [{ packageName: 'pkg-a', newVersion: '1.1.0', filePath: 'packages/a/package.json' }],
          changelogs: [
            {
              packageName: 'pkg-a',
              version: '1.1.0',
              previousVersion: '1.0.0',
              revisionRange: 'v1.0.0..HEAD',
              repoUrl: null,
              entries: [{ type: 'added', description: 'New feature' }, sharedEntry],
            },
          ],
          tags: ['pkg-a@v1.1.0'],
        },
        notesGenerated: false,
      };
      const result = formatPreviewComment(singlePkg);
      expect(result).not.toContain('Project-wide changes');
      // Entry should appear in the package's own changelog
      expect(result).toContain('- Update CI pipeline');
    });

    it('does not create a Project-wide section when all entries are unique', () => {
      const result = formatPreviewComment(releaseOutput);
      expect(result).not.toContain('Project-wide changes');
    });
  });

  it('includes footer', () => {
    const result = formatPreviewComment(releaseOutput);
    expect(result).toContain('Updated automatically by [ReleaseKit]');
  });

  it('shows no-changes message when result is null', () => {
    const result = formatPreviewComment(null);
    expect(result).toContain('<!-- releasekit-preview -->');
    expect(result).toContain('<summary><b>Release Preview</b> — no release</summary>');
    expect(result).toContain('No releasable changes detected');
    expect(result).toContain('[!NOTE]');
    expect(result).not.toContain('### Packages');
  });

  // --- Strategy-specific messaging ---

  describe('release strategy messaging', () => {
    it('uses direct intro by default', () => {
      const result = formatPreviewComment(releaseOutput);
      expect(result).toContain('This PR will trigger the following release when merged:');
    });

    it('uses manual intro when strategy is manual', () => {
      const result = formatPreviewComment(releaseOutput, { strategy: 'manual' });
      expect(result).toContain('If released, this PR would include:');
    });

    it('uses direct intro when strategy is direct', () => {
      const result = formatPreviewComment(releaseOutput, { strategy: 'direct' });
      expect(result).toContain('This PR will trigger the following release when merged:');
    });

    it('uses standing-pr intro without existing PR number', () => {
      const result = formatPreviewComment(releaseOutput, { strategy: 'standing-pr' });
      expect(result).toContain('Merging this PR will create a new release PR with the following changes:');
    });

    it('uses standing-pr intro with existing PR number', () => {
      const result = formatPreviewComment(releaseOutput, { strategy: 'standing-pr', standingPrNumber: 99 });
      expect(result).toContain('These changes will be added to the release PR (#99) when merged:');
    });

    it('uses scheduled intro when strategy is scheduled', () => {
      const result = formatPreviewComment(releaseOutput, { strategy: 'scheduled' });
      expect(result).toContain('These changes will be included in the next scheduled release:');
    });

    // No-changes messages per strategy

    it('shows direct no-changes message by default', () => {
      const result = formatPreviewComment(null);
      expect(result).toContain('Merging this PR will not trigger a release');
    });

    it('shows manual no-changes message', () => {
      const result = formatPreviewComment(null, { strategy: 'manual' });
      expect(result).toContain('Run the release workflow manually');
    });

    it('shows direct no-changes message', () => {
      const result = formatPreviewComment(null, { strategy: 'direct' });
      expect(result).toContain('Merging this PR will not trigger a release');
    });

    it('shows standing-pr no-changes message', () => {
      const result = formatPreviewComment(null, { strategy: 'standing-pr' });
      expect(result).toContain('will not affect the release PR');
    });

    it('shows scheduled no-changes message', () => {
      const result = formatPreviewComment(null, { strategy: 'scheduled' });
      expect(result).toContain('will not be included in the next scheduled release');
    });
  });

  // --- Label context banners ---

  describe('label context banners', () => {
    it('shows no banner when no labelContext', () => {
      const result = formatPreviewComment(releaseOutput);
      expect(result).not.toContain('[!WARNING]');
      expect(result).not.toContain('[!IMPORTANT]');
      expect(result).not.toContain('labeled for');
    });

    it('shows skip banner in commit mode', () => {
      const result = formatPreviewComment(releaseOutput, {
        labelContext: { trigger: 'commit', skip: true, noBumpLabel: false },
      });
      expect(result).toContain('[!WARNING]');
      expect(result).toContain('This PR is marked to skip release.');
      // Still shows the preview content underneath
      expect(result).toContain('### Packages');
    });

    it('shows major override banner in commit mode', () => {
      const result = formatPreviewComment(releaseOutput, {
        labelContext: { trigger: 'commit', skip: false, bumpLabel: 'major', noBumpLabel: false },
      });
      expect(result).toContain('[!IMPORTANT]');
      expect(result).toContain('labeled for a **major** release');
    });

    it('shows "no release label" message in label mode with no bump label', () => {
      const result = formatPreviewComment(null, {
        labelContext: { trigger: 'label', skip: false, noBumpLabel: true },
      });
      expect(result).toContain('No release label detected');
      expect(result).toContain('release:patch');
      expect(result).toContain('release:minor');
      expect(result).toContain('release:major');
      expect(result).not.toContain('### Packages');
    });

    it('uses custom configured labels in the "no release label" message', () => {
      const result = formatPreviewComment(null, {
        labelContext: {
          trigger: 'label',
          skip: false,
          noBumpLabel: true,
          labels: {
            stable: 'custom:stable',
            prerelease: 'custom:pre',
            skip: 'custom:skip',
            major: 'custom:major',
            minor: 'custom:minor',
            patch: 'custom:patch',
          },
        },
      });
      expect(result).toContain('No release label detected');
      expect(result).toContain('`custom:patch`');
      expect(result).toContain('`custom:minor`');
      expect(result).toContain('`custom:major`');
    });

    it('shows bump label banner in label mode', () => {
      const result = formatPreviewComment(releaseOutput, {
        labelContext: { trigger: 'label', skip: false, bumpLabel: 'minor', noBumpLabel: false },
      });
      expect(result).toContain('[!NOTE]');
      expect(result).toContain('labeled for a **minor** release');
      expect(result).toContain('### Packages');
    });

    it('shows patch label banner in label mode', () => {
      const result = formatPreviewComment(releaseOutput, {
        labelContext: { trigger: 'label', skip: false, bumpLabel: 'patch', noBumpLabel: false },
      });
      expect(result).toContain('labeled for a **patch** release');
    });

    it('shows major label banner in label mode', () => {
      const result = formatPreviewComment(releaseOutput, {
        labelContext: { trigger: 'label', skip: false, bumpLabel: 'major', noBumpLabel: false },
      });
      expect(result).toContain('[!NOTE]');
      expect(result).toContain('labeled for a **major** release');
    });
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
