import type { VersionOutput } from '@releasekit/core';
import { describe, expect, it } from 'vitest';
import { formatPreviewComment } from '../../src/preview/format.js';
import type { MergedRow } from '../../src/preview/merge.js';
import type { StandingPRSnapshot } from '../../src/standing-pr/standing-pr.js';
import type { ReleaseOutput } from '../../src/types.js';

function snapshotFor(
  updates: Array<{ name: string; version: string }>,
  overrides: Partial<StandingPRSnapshot> = {},
): StandingPRSnapshot {
  return {
    number: 42,
    url: 'https://github.com/owner/repo/pull/42',
    openedAt: new Date(Date.now() - 2 * 3_600_000).toISOString(), // 2h ago
    gateState: 'success',
    manifest: {
      schemaVersion: 2,
      versionOutput: {
        dryRun: false,
        updates: updates.map((u) => ({
          packageName: u.name,
          newVersion: u.version,
          filePath: `packages/${u.name}/package.json`,
        })),
        changelogs: [],
        tags: [],
      },
      releaseNotes: {},
      notesFiles: [],
      createdAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
      baseSha: 'abc',
      firstUpdatedAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
    },
    ...overrides,
  };
}

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
  commitMessage: 'chore: release 0.3.1',
  tags: ['@releasekit/version@v0.3.1', '@releasekit/notes@v0.3.1'],
};

const releaseOutput: ReleaseOutput = {
  versionOutput,
  notesGenerated: true,
};

describe('formatPreviewComment', () => {
  it('should include marker comment at the top', () => {
    const result = formatPreviewComment(releaseOutput);
    expect(result.startsWith('<!-- releasekit-preview -->')).toBe(true);
  });

  it('should wrap entire comment in a collapsed details element', () => {
    const result = formatPreviewComment(releaseOutput);
    expect(result).toContain('<details>');
    expect(result).toContain('<summary><b>Release Preview</b>');
    expect(result).toMatch(/<\/details>\s*$/);
  });

  it('should show package count in summary for multiple packages', () => {
    const result = formatPreviewComment(releaseOutput);
    expect(result).toContain('<summary><b>Release Preview</b> — 2 packages</summary>');
  });

  it('should show package name and version in summary for single package', () => {
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

  it('should include package table', () => {
    const result = formatPreviewComment(releaseOutput);
    expect(result).toContain('| `@releasekit/version` | 0.3.1 |');
    expect(result).toContain('| `@releasekit/notes` | 0.3.1 |');
  });

  it('should include changelog with entry grouping by type', () => {
    const result = formatPreviewComment(releaseOutput);
    expect(result).toContain('#### Added');
    expect(result).toContain('- New dry-run flag (`cli`)');
    expect(result).toContain('#### Fixed');
    expect(result).toContain('- Fix prerelease sorting (`semver`) #42');
    expect(result).toContain('#### Chores');
    expect(result).toContain('- Migrate to Vitest');
  });

  it('should wrap each package changelog in details element', () => {
    const result = formatPreviewComment(releaseOutput);
    expect(result).toContain('<details>');
    expect(result).toContain('<b>@releasekit/version</b> 0.3.0 → 0.3.1');
    expect(result).toContain('<b>@releasekit/notes</b> 0.3.0 → 0.3.1');
    expect(result).toContain('</details>');
  });

  it('should include tags', () => {
    const result = formatPreviewComment(releaseOutput);
    expect(result).toContain('- `@releasekit/version@v0.3.1`');
    expect(result).toContain('- `@releasekit/notes@v0.3.1`');
  });

  describe('shared entries rendering', () => {
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
            entries: [{ type: 'added', description: 'New feature in pkg-a' }],
          },
          {
            packageName: 'pkg-b',
            version: '1.1.0',
            previousVersion: '1.0.0',
            revisionRange: 'v1.0.0..HEAD',
            repoUrl: null,
            entries: [{ type: 'fixed', description: 'Bug fix in pkg-b' }],
          },
        ],
        sharedEntries: [sharedEntry],
        tags: ['pkg-a@v1.1.0', 'pkg-b@v1.1.0'],
      },
      notesGenerated: false,
    };

    it('should render sharedEntries in a Project-wide changes section', () => {
      const result = formatPreviewComment(outputWithShared);
      expect(result).toContain('<b>Project-wide changes</b>');
      expect(result).toContain('- Update CI pipeline');
    });

    it('should ensure shared entries appear only once, not in individual package changelogs', () => {
      const result = formatPreviewComment(outputWithShared);
      expect(result.split('Update CI pipeline').length - 1).toBe(1);
    });

    it('should keep package-specific entries in each package changelog', () => {
      const result = formatPreviewComment(outputWithShared);
      expect(result).toContain('- New feature in pkg-a');
      expect(result).toContain('- Bug fix in pkg-b');
    });

    it('should omit the package details block when that package has no entries', () => {
      const noEntries: ReleaseOutput = {
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
              entries: [], // no package-specific changes
            },
            {
              packageName: 'pkg-b',
              version: '1.1.0',
              previousVersion: '1.0.0',
              revisionRange: 'v1.0.0..HEAD',
              repoUrl: null,
              entries: [{ type: 'fixed', description: 'Bug fix in pkg-b' }],
            },
          ],
          sharedEntries: [sharedEntry],
          tags: [],
        },
        notesGenerated: false,
      };
      const result = formatPreviewComment(noEntries);
      expect(result).not.toContain('<b>pkg-a</b>');
      expect(result).toContain('<b>pkg-b</b>');
      expect(result.split(sharedEntry.description).length - 1).toBe(1);
    });

    it('should not render a Project-wide section when sharedEntries is absent', () => {
      const result = formatPreviewComment(releaseOutput);
      expect(result).not.toContain('Project-wide changes');
    });
  });

  it('should include footer', () => {
    const result = formatPreviewComment(releaseOutput);
    expect(result).toContain('Updated automatically by [ReleaseKit]');
  });

  it('should show no-changes message when result is null', () => {
    const result = formatPreviewComment(null);
    expect(result).toContain('<!-- releasekit-preview -->');
    expect(result).toContain('<summary><b>Release Preview</b> — no release</summary>');
    expect(result).toContain('No releasable changes detected');
    expect(result).toContain('**Note:**');
    expect(result).not.toContain('### Packages');
  });

  // --- Strategy-specific messaging ---

  describe('release strategy messaging', () => {
    it('should use direct intro by default', () => {
      const result = formatPreviewComment(releaseOutput);
      expect(result).toContain('This PR will trigger the following release when merged:');
    });

    it('should use manual intro when strategy is manual', () => {
      const result = formatPreviewComment(releaseOutput, { strategy: 'manual' });
      expect(result).toContain('If released, this PR would include:');
    });

    it('should use direct intro when strategy is direct', () => {
      const result = formatPreviewComment(releaseOutput, { strategy: 'direct' });
      expect(result).toContain('This PR will trigger the following release when merged:');
    });

    it('should use standing-pr intro without existing PR number', () => {
      const result = formatPreviewComment(releaseOutput, { strategy: 'standing-pr' });
      expect(result).toContain('Merging this PR will create a new release PR with the following changes:');
    });

    it('should use standing-pr intro with existing PR number', () => {
      const result = formatPreviewComment(releaseOutput, { strategy: 'standing-pr', standingPrNumber: 99 });
      expect(result).toContain('These changes will be added to the release PR (#99) when merged:');
    });

    it('should use scheduled intro when strategy is scheduled', () => {
      const result = formatPreviewComment(releaseOutput, { strategy: 'scheduled' });
      expect(result).toContain('These changes will be included in the next scheduled release:');
    });

    // No-changes messages per strategy

    it('should show direct no-changes message by default', () => {
      const result = formatPreviewComment(null);
      expect(result).toContain('Merging this PR will not trigger a release');
    });

    it('should show manual no-changes message', () => {
      const result = formatPreviewComment(null, { strategy: 'manual' });
      expect(result).toContain('Run the release workflow manually');
    });

    it('should show direct no-changes message', () => {
      const result = formatPreviewComment(null, { strategy: 'direct' });
      expect(result).toContain('Merging this PR will not trigger a release');
    });

    it('should show standing-pr no-changes message', () => {
      const result = formatPreviewComment(null, { strategy: 'standing-pr' });
      expect(result).toContain('will not affect the release PR');
    });

    it('should show scheduled no-changes message', () => {
      const result = formatPreviewComment(null, { strategy: 'scheduled' });
      expect(result).toContain('will not be included in the next scheduled release');
    });
  });

  // --- Standing PR snapshot + merge table ---

  describe('standing PR snapshot', () => {
    it('should render the snapshot block in the no-release branch when strategy is standing-pr', () => {
      const snapshot = snapshotFor([{ name: '@a/notes', version: '0.5.0' }]);
      const result = formatPreviewComment(null, { strategy: 'standing-pr', standingPrSnapshot: snapshot });
      expect(result).toContain('**Standing release PR:**');
      expect(result).toContain('[#42](https://github.com/owner/repo/pull/42)');
      expect(result).toContain('1 package queued');
      expect(result).toContain('✅ ready to merge');
    });

    it('should render the snapshot one-liner above the collapsible details so it is always visible', () => {
      const snapshot = snapshotFor([
        { name: '@a/notes', version: '0.5.0' },
        { name: '@a/version', version: '0.3.2' },
      ]);
      const result = formatPreviewComment(releaseOutput, { strategy: 'standing-pr', standingPrSnapshot: snapshot });
      expect(result).toContain('**Standing release PR:**');
      expect(result).toContain('2 packages queued');
      // The snapshot must precede the <details> open tag (rendered outside, always visible).
      const detailsIdx = result.indexOf('<details>');
      const snapshotIdx = result.indexOf('**Standing release PR:**');
      expect(snapshotIdx).toBeGreaterThan(-1);
      expect(detailsIdx).toBeGreaterThan(snapshotIdx);
    });

    it('should show the pending gate badge with countdown when gateState is pending', () => {
      const snapshot = snapshotFor([{ name: '@a/notes', version: '0.5.0' }], {
        gateState: 'pending',
        gateReason: 'Waiting 4h 20m for minAge',
      });
      const result = formatPreviewComment(null, { strategy: 'standing-pr', standingPrSnapshot: snapshot });
      expect(result).toContain('⏳ Waiting 4h 20m for minAge');
      expect(result).not.toContain('✅ ready to merge');
    });

    it('should omit the snapshot when strategy is not standing-pr (defensive)', () => {
      const snapshot = snapshotFor([{ name: '@a/notes', version: '0.5.0' }]);
      const result = formatPreviewComment(releaseOutput, { strategy: 'direct', standingPrSnapshot: snapshot });
      expect(result).not.toContain('**Standing release PR:**');
    });

    it('should render the merge table with escalation, new, and unchanged annotations', () => {
      const snapshot = snapshotFor([{ name: '@a/notes', version: '0.5.0' }]);
      const mergedRows: MergedRow[] = [
        {
          packageName: '@a/notes',
          baseline: '0.4.0',
          standing: '0.4.1',
          current: '0.5.0',
          afterMerge: '0.5.0',
          status: 'escalated',
        },
        {
          packageName: '@a/publish',
          baseline: '0.2.0',
          current: '0.2.1',
          afterMerge: '0.2.1',
          status: 'new-from-pr',
        },
        {
          packageName: '@a/version',
          baseline: '0.3.1',
          standing: '0.3.2',
          current: '0.3.2',
          afterMerge: '0.3.2',
          status: 'unchanged',
        },
      ];
      const result = formatPreviewComment(releaseOutput, {
        strategy: 'standing-pr',
        standingPrSnapshot: snapshot,
        mergedRows,
      });
      expect(result).toContain('### After merge — predicted release');
      expect(result).toContain('Approximate. The standing PR rebuilds against `main`');
      expect(result).toContain('| Package | Standing PR | This PR | After merge |');
      expect(result).toContain('| `@a/notes` | 0.4.1 | 0.5.0 | 0.5.0 ⚠ escalated from 0.4.1 |');
      expect(result).toContain('| `@a/publish` | — | 0.2.1 | 0.2.1 (new) |');
      expect(result).toContain('| `@a/version` | 0.3.2 | 0.3.2 | 0.3.2 |');
    });

    it('should omit the merge table when no rows are provided', () => {
      const snapshot = snapshotFor([{ name: '@a/notes', version: '0.5.0' }]);
      const result = formatPreviewComment(releaseOutput, { strategy: 'standing-pr', standingPrSnapshot: snapshot });
      expect(result).not.toContain('### After merge');
    });

    it('should not change output when no snapshot is provided (regression guard)', () => {
      const withoutSnapshot = formatPreviewComment(releaseOutput, { strategy: 'standing-pr' });
      expect(withoutSnapshot).not.toContain('**Standing release PR:**');
      expect(withoutSnapshot).not.toContain('### After merge');
    });

    it('should use "this PR contributes no changes" summary when snapshot is present and no result', () => {
      const snapshot = snapshotFor([{ name: '@a/notes', version: '0.5.0' }]);
      const result = formatPreviewComment(null, { strategy: 'standing-pr', standingPrSnapshot: snapshot });
      expect(result).toContain('<summary><b>Release Preview</b> — this PR contributes no changes</summary>');
      expect(result).not.toContain('— no release</summary>');
    });

    it('should keep "no release" summary when snapshot is absent', () => {
      const result = formatPreviewComment(null, { strategy: 'standing-pr' });
      expect(result).toContain('<summary><b>Release Preview</b> — no release</summary>');
    });

    it('should render a queued-for-release table inside the details when no result and snapshot has changelogs', () => {
      const snapshot = snapshotFor([{ name: '@a/notes', version: '0.5.0' }]);
      snapshot.manifest.versionOutput.changelogs = [
        {
          packageName: '@a/notes',
          version: '0.5.0',
          previousVersion: '0.4.2',
          revisionRange: 'v0.4.2..HEAD',
          repoUrl: null,
          entries: [{ type: 'feat', description: 'queued change' }],
        },
        {
          packageName: '@a/version',
          version: '0.3.2',
          previousVersion: '0.3.1',
          revisionRange: 'v0.3.1..HEAD',
          repoUrl: null,
          entries: [{ type: 'fix', description: 'queued fix' }],
        },
      ];
      const result = formatPreviewComment(null, { strategy: 'standing-pr', standingPrSnapshot: snapshot });
      expect(result).toContain('### Currently queued for release');
      expect(result).toContain('| Package | Current | Next |');
      expect(result).toContain('| `@a/notes` | 0.4.2 | 0.5.0 |');
      expect(result).toContain('| `@a/version` | 0.3.1 | 0.3.2 |');
    });

    it('should omit the queued table when snapshot has no changelogs with entries', () => {
      const snapshot = snapshotFor([{ name: '@a/notes', version: '0.5.0' }]);
      // changelogs is empty by default in snapshotFor
      const result = formatPreviewComment(null, { strategy: 'standing-pr', standingPrSnapshot: snapshot });
      expect(result).not.toContain('### Currently queued for release');
    });
  });

  // --- Label context banners ---

  describe('label context banners', () => {
    it('should show no banner when no labelContext', () => {
      const result = formatPreviewComment(releaseOutput);
      expect(result).not.toContain('**Warning:**');
      expect(result).not.toContain('**Important:**');
      expect(result).not.toContain('labeled for');
    });

    it('should show skip banner in commit mode', () => {
      const result = formatPreviewComment(releaseOutput, {
        labelContext: { trigger: 'commit', skip: true, noBumpLabel: false },
      });
      expect(result).toContain('**Warning:**');
      expect(result).toContain('This PR is marked to skip release.');
      // Still shows the preview content underneath
      expect(result).toContain('### Packages');
    });

    it('should show major override banner in commit mode', () => {
      const result = formatPreviewComment(releaseOutput, {
        labelContext: { trigger: 'commit', skip: false, bumpLabel: 'major', noBumpLabel: false },
      });
      expect(result).toContain('**Important:**');
      expect(result).toContain('labeled for a **major** release');
    });

    it('should show "no release label" message in label mode with no bump label', () => {
      const result = formatPreviewComment(null, {
        labelContext: { trigger: 'label', skip: false, noBumpLabel: true },
      });
      expect(result).toContain('No bump label detected');
      expect(result).toContain('bump:patch');
      expect(result).toContain('bump:minor');
      expect(result).toContain('bump:major');
      expect(result).not.toContain('### Packages');
    });

    it('should use custom configured labels in the "no release label" message', () => {
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
      expect(result).toContain('No bump label detected');
      expect(result).toContain('`custom:patch`');
      expect(result).toContain('`custom:minor`');
      expect(result).toContain('`custom:major`');
    });

    it('should show bump label banner in label mode', () => {
      const result = formatPreviewComment(releaseOutput, {
        labelContext: { trigger: 'label', skip: false, bumpLabel: 'minor', noBumpLabel: false },
      });
      expect(result).toContain('labeled for a **minor** release');
      expect(result).toContain('### Packages');
    });

    it('should show patch label banner in label mode', () => {
      const result = formatPreviewComment(releaseOutput, {
        labelContext: { trigger: 'label', skip: false, bumpLabel: 'patch', noBumpLabel: false },
      });
      expect(result).toContain('labeled for a **patch** release');
    });

    it('should show major label banner in label mode', () => {
      const result = formatPreviewComment(releaseOutput, {
        labelContext: { trigger: 'label', skip: false, bumpLabel: 'major', noBumpLabel: false },
      });
      expect(result).toContain('labeled for a **major** release');
    });

    it('should show stable-only banner in label mode (graduation)', () => {
      const result = formatPreviewComment(releaseOutput, {
        labelContext: { trigger: 'label', skip: false, noBumpLabel: false, prerelease: false, stable: true },
      });
      expect(result).toContain('labeled for a **stable** release (graduation from prerelease)');
      expect(result).toContain('### Packages');
    });

    it('should show prerelease-only banner in label mode (conventional commits driven)', () => {
      const result = formatPreviewComment(releaseOutput, {
        labelContext: { trigger: 'label', skip: false, noBumpLabel: false, prerelease: true, stable: false },
      });
      expect(result).toContain('labeled for a **prerelease** release (bump from conventional commits)');
      expect(result).toContain('### Packages');
    });
  });

  it('should handle single package without changelogs', () => {
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

  it('should handle entries with unknown types', () => {
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

  it('should handle null previousVersion', () => {
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

  // --- Scope label context ---

  describe('scope labels in label context', () => {
    it('should show scope banner when scope labels present', () => {
      const result = formatPreviewComment(releaseOutput, {
        labelContext: {
          trigger: 'commit',
          skip: false,
          noBumpLabel: false,
          scopeLabels: ['@wdio/native-*'],
        },
      });
      expect(result).toContain('**Scope:**');
      expect(result).toContain('@wdio/native-*');
    });

    it('should show multiple scope labels', () => {
      const result = formatPreviewComment(releaseOutput, {
        labelContext: {
          trigger: 'commit',
          skip: false,
          noBumpLabel: false,
          scopeLabels: ['@wdio/native-*', '@wdio/tauri-*'],
        },
      });
      expect(result).toContain('**Scope:**');
      expect(result).toContain('@wdio/native-*');
      expect(result).toContain('@wdio/tauri-*');
    });

    it('should show scope with bump label in label mode', () => {
      const result = formatPreviewComment(releaseOutput, {
        labelContext: {
          trigger: 'label',
          skip: false,
          bumpLabel: 'minor',
          noBumpLabel: false,
          scopeLabels: ['@wdio/native-*'],
        },
      });
      expect(result).toContain('**Scope:**');
      expect(result).toContain('@wdio/native-*');
      expect(result).toContain('labeled for a **minor** release');
    });

    it('should omit scope when no scope labels present', () => {
      const result = formatPreviewComment(releaseOutput, {
        labelContext: {
          trigger: 'commit',
          skip: false,
          noBumpLabel: false,
        },
      });
      expect(result).not.toContain('**Scope:**');
    });

    it('should show scope even when noBumpLabel is true in label mode', () => {
      const result = formatPreviewComment(null, {
        labelContext: {
          trigger: 'label',
          skip: false,
          noBumpLabel: true,
          scopeLabels: ['@wdio/native-*'],
        },
      });
      // Scope should still show even when there's no bump label
      expect(result).toContain('**Scope:**');
      expect(result).toContain('@wdio/native-*');
      expect(result).toContain('No bump label detected');
    });
  });
});
