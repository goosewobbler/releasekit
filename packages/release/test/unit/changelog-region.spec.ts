import type { VersionOutput } from '@releasekit/core';
import { describe, expect, it } from 'vitest';
import { makeRowChangelogRenderer, renderCombinedFooter } from '../../src/standing-pr/changelog-region.js';
import { type PrimaryConfig, renderSelectionRegion } from '../../src/standing-pr/selection-region.js';

type Changelog = VersionOutput['changelogs'][number];

function cl(packageName: string, entries: Changelog['entries'], repoUrl: string | null = null): Changelog {
  return { packageName, version: '1.0.0', previousVersion: '0.9.0', revisionRange: '', repoUrl, entries };
}

describe('changelog-region', () => {
  describe('makeRowChangelogRenderer', () => {
    it('should aggregate a unit’s primary and coupled members into one collapsed pane', () => {
      const render = makeRowChangelogRenderer([
        cl('@scope/app', [{ type: 'feat', description: 'App feature' }]),
        cl('@scope/lib', [{ type: 'fix', description: 'Lib fix' }]),
      ]);
      const block = render(['@scope/app', '@scope/lib'], false, '  ');
      // One <details> covering both packages, grouped by Keep-a-Changelog type. The disclosure tags stay
      // un-quoted (raw HTML); only the inner content is blockquoted (`> `), indented to nest under its row.
      expect(block).toContain('  <details><summary>Changelog (2 entries)</summary>');
      expect(block).toContain('  > #### Added');
      expect(block).toContain('  > - App feature');
      expect(block).toContain('  > #### Fixed');
      expect(block).toContain('  > - Lib fix');
      expect(block).toContain('  </details>');
      // Multi-package unit → inline attribution per line.
      expect(block).toContain('_(app)_');
      expect(block).toContain('_(lib)_');
    });

    it('should omit attribution for a single-package row', () => {
      const render = makeRowChangelogRenderer([cl('@scope/app', [{ type: 'feat', description: 'Solo feature' }])]);
      const block = render(['@scope/app'], false, '  ');
      expect(block).toContain('- Solo feature');
      expect(block).not.toContain('_(app)_');
    });

    it('should return empty string when the row’s packages have no entries', () => {
      const render = makeRowChangelogRenderer([cl('@scope/app', [])]);
      expect(render(['@scope/app'], false, '  ')).toBe('');
      expect(render(['@scope/missing'], false, '  ')).toBe('');
    });

    it('should drop synthetic lockstep-carry placeholders', () => {
      const render = makeRowChangelogRenderer([
        cl('@scope/app', [{ type: 'feat', description: 'Real change' }]),
        cl('@scope/carry', [{ type: 'chore', description: 'Update version to 1.0.0', synthetic: true }]),
      ]);
      const block = render(['@scope/app', '@scope/carry'], false, '  ');
      expect(block).toContain('Changelog (1 entry)');
      expect(block).not.toContain('Update version');
    });

    it('should grey and flag a held-back row’s changelog', () => {
      const render = makeRowChangelogRenderer([cl('@scope/app', [{ type: 'feat', description: 'Held feature' }])]);
      const block = render(['@scope/app'], true, '  ');
      expect(block).toContain('<s>Changelog (1 entry)</s> — held back, won’t publish');
      // Entries stay visible so the reviewer can see what is being held.
      expect(block).toContain('- Held feature');
    });
  });

  describe('renderCombinedFooter', () => {
    function output(over: Partial<VersionOutput>): VersionOutput {
      return {
        dryRun: false,
        updates: [],
        changelogs: [],
        tags: [],
        ...over,
      };
    }

    it('should de-duplicate a change shared by two packages into one attributed line', () => {
      const shared = { type: 'fix', description: 'Patch serializer' };
      const footer = renderCombinedFooter(output({ changelogs: [cl('@scope/a', [shared]), cl('@scope/b', [shared])] }));
      expect(footer.split('Patch serializer').length - 1).toBe(1);
      expect(footer).toContain('Show all changes (1 change, de-duplicated)');
      expect(footer).toContain('_(a, b)_');
    });

    it('should keep same-description changes with different scopes as distinct lines', () => {
      const footer = renderCombinedFooter(
        output({
          changelogs: [
            cl('@scope/a', [{ type: 'fix', description: 'Fix edge case', scope: 'cli' }]),
            cl('@scope/b', [{ type: 'fix', description: 'Fix edge case', scope: 'router' }]),
          ],
        }),
      );
      expect(footer).toContain('(`cli`)');
      expect(footer).toContain('(`router`)');
      expect(footer).toContain('Show all changes (2 changes, de-duplicated)');
    });

    it('should de-dupe a bare #N in the description that also appears in the appended label (#507)', () => {
      const footer = renderCombinedFooter(
        output({
          changelogs: [
            cl(
              '@scope/a',
              [
                {
                  type: 'fix',
                  description: 'failed queued batch (#467)',
                  issueIds: ['#475', '#467'],
                  prNumber: '#475',
                },
              ],
              'https://github.com/octocat/hello',
            ),
          ],
        }),
      );
      // The `(#467)` carried into the description is removed — it shows once, in the appended label.
      expect(footer).toContain('failed queued batch (PR [#475](https://github.com/octocat/hello/pull/475)');
      expect(footer).toContain('closes [#467](https://github.com/octocat/hello/issues/467)');
      expect(footer).not.toContain('batch (#467)');
    });

    it('should fold project-wide shared entries into the flat type buckets', () => {
      const footer = renderCombinedFooter(
        output({
          changelogs: [cl('@scope/a', [{ type: 'feat', description: 'Package feature' }])],
          sharedEntries: [{ type: 'fix', description: 'CI tweak' }],
        }),
      );
      expect(footer).toContain('#### Added');
      expect(footer).toContain('- Package feature');
      expect(footer).toContain('#### Fixed');
      expect(footer).toContain('- CI tweak');
      expect(footer).toContain('Show all changes (2 changes, de-duplicated)');
    });

    it('should return empty string when there are no real entries', () => {
      expect(renderCombinedFooter(output({ changelogs: [cl('@scope/a', [])] }))).toBe('');
    });

    it('should render only project-wide shared entries in sharedOnly mode', () => {
      const footer = renderCombinedFooter(
        output({
          changelogs: [cl('@scope/a', [{ type: 'feat', description: 'Package feature' }])],
          sharedEntries: [{ type: 'fix', description: 'Shared infra' }],
        }),
        { sharedOnly: true },
      );
      expect(footer).toContain('Show project-wide changes (1 change)');
      expect(footer).toContain('- Shared infra');
      // The per-package change is covered per-row, so it is excluded from this shared-only block.
      expect(footer).not.toContain('Package feature');
    });

    it('should return empty string in sharedOnly mode when there are no shared entries', () => {
      const footer = renderCombinedFooter(
        output({ changelogs: [cl('@scope/a', [{ type: 'feat', description: 'Package feature' }])] }),
        { sharedOnly: true },
      );
      expect(footer).toBe('');
    });
  });

  describe('issue refs + mention escaping (#499)', () => {
    const repo = 'https://github.com/octocat/hello';

    function output(over: Partial<VersionOutput>): VersionOutput {
      return { dryRun: false, updates: [], changelogs: [], tags: [], ...over };
    }

    it('should render a canonical issue link in the per-row pane by default (link mode)', () => {
      const render = makeRowChangelogRenderer([
        cl('@scope/app', [{ type: 'feat', description: 'App feature', issueIds: ['#481'] }], repo),
      ]);
      const block = render(['@scope/app'], false, '');
      expect(block).toContain('- App feature ([#481](https://github.com/octocat/hello/issues/481))');
    });

    it('should escape refs in escape mode', () => {
      const render = makeRowChangelogRenderer(
        [cl('@scope/app', [{ type: 'feat', description: 'App feature', issueIds: ['#481'] }], repo)],
        'escape',
      );
      const block = render(['@scope/app'], false, '');
      expect(block).toContain('- App feature (\\#481)');
      expect(block).not.toContain('issues/481');
    });

    it('should drop refs in strip mode', () => {
      const render = makeRowChangelogRenderer(
        [cl('@scope/app', [{ type: 'feat', description: 'App feature', issueIds: ['#481'] }], repo)],
        'strip',
      );
      const block = render(['@scope/app'], false, '');
      expect(block).toContain('- App feature');
      expect(block).not.toContain('#481');
    });

    it('should fall back to escape in link mode when no GitHub repo URL is present', () => {
      const render = makeRowChangelogRenderer([
        cl('@scope/app', [{ type: 'feat', description: 'App feature', issueIds: ['#481'] }], null),
      ]);
      const block = render(['@scope/app'], false, '');
      expect(block).toContain('- App feature (\\#481)');
    });

    it('should always neutralise a scoped-package mention in the description', () => {
      const render = makeRowChangelogRenderer([
        cl('@scope/app', [{ type: 'feat', description: 'Bump @wdio/native-cdp-bridge' }], repo),
      ]);
      const block = render(['@scope/app'], false, '');
      expect(block).toContain('- Bump \\@wdio/native-cdp-bridge');
    });

    it('should render refs and escape mentions in the combined footer', () => {
      const footer = renderCombinedFooter(
        output({
          changelogs: [cl('@scope/a', [{ type: 'fix', description: 'Fix @octocat case', issueIds: ['#7'] }], repo)],
        }),
      );
      expect(footer).toContain('- Fix \\@octocat case ([#7](https://github.com/octocat/hello/issues/7))');
    });

    it('should honour escape mode in the combined footer', () => {
      const footer = renderCombinedFooter(
        output({ changelogs: [cl('@scope/a', [{ type: 'fix', description: 'Patch', issueIds: ['#7'] }], repo)] }),
        { refs: 'escape' },
      );
      expect(footer).toContain('- Patch (\\#7)');
    });

    it('should label the PR and closed issues in the per-row pane when prNumber is set', () => {
      const render = makeRowChangelogRenderer([
        cl(
          '@scope/app',
          [{ type: 'feat', description: 'App feature', issueIds: ['#503', '#500'], prNumber: '#503' }],
          repo,
        ),
      ]);
      const block = render(['@scope/app'], false, '');
      expect(block).toContain(
        '- App feature (PR [#503](https://github.com/octocat/hello/pull/503) · closes [#500](https://github.com/octocat/hello/issues/500))',
      );
    });

    it('should render a PR-only ref (no closes) in the combined footer when there are no closed issues', () => {
      const footer = renderCombinedFooter(
        output({
          changelogs: [
            cl('@scope/a', [{ type: 'fix', description: 'Patch', issueIds: ['#503'], prNumber: '#503' }], repo),
          ],
        }),
      );
      expect(footer).toContain('- Patch (PR [#503](https://github.com/octocat/hello/pull/503))');
    });

    it('should fall back to a plain ref list for an old entry with no prNumber', () => {
      const footer = renderCombinedFooter(
        output({ changelogs: [cl('@scope/a', [{ type: 'fix', description: 'Patch', issueIds: ['#500'] }], repo)] }),
      );
      expect(footer).toContain('- Patch ([#500](https://github.com/octocat/hello/issues/500))');
      expect(footer).not.toContain('PR [#500]');
    });
  });

  describe('blockquote wrapping (PR-comment surface)', () => {
    const repo = 'https://github.com/octocat/hello';

    function output(over: Partial<VersionOutput>): VersionOutput {
      return { dryRun: false, updates: [], changelogs: [], tags: [], ...over };
    }

    it('should blockquote the footer content but leave the disclosure tags un-quoted', () => {
      const footer = renderCombinedFooter(
        output({ changelogs: [cl('@scope/a', [{ type: 'feat', description: 'A feature' }], repo)] }),
      );
      // The <details>/<summary>/</details> raw-HTML tags render un-quoted; only the inner content
      // carries the `> ` bar (blank lines keep a bare `>`), with a plain blank line separating them.
      expect(footer).toContain('<details><summary>Show all changes (1 change, de-duplicated)</summary>');
      expect(footer).not.toContain('> <details>');
      expect(footer).not.toContain('> </details>');
      expect(footer).toContain('> #### Added');
      expect(footer).toContain('> - A feature');
      const fl = footer.split('\n');
      expect(fl[0]).toBe('<details><summary>Show all changes (1 change, de-duplicated)</summary>');
      expect(fl[1]).toBe('');
      expect(fl[fl.length - 1]).toBe('</details>');
      expect(fl[fl.length - 2]).toBe('');
    });

    it('should blockquote the per-row pane content, nested under its row indent', () => {
      const render = makeRowChangelogRenderer([
        cl('@scope/app', [{ type: 'feat', description: 'Solo feature' }], repo),
      ]);
      const block = render(['@scope/app'], false, '  ');
      const bl = block.split('\n');
      // Disclosure tags carry only the indent; the inner content is `  > `-prefixed.
      expect(bl[0]).toBe('  <details><summary>Changelog (1 entry)</summary>');
      expect(bl[bl.length - 1]).toBe('  </details>');
      expect(block).toContain('  > #### Added');
      expect(block).toContain('  > - Solo feature');
    });
  });

  describe('per-row attachment via renderSelectionRegion', () => {
    const cfg = (over: Partial<PrimaryConfig> = {}): PrimaryConfig => ({
      primaryPackages: ['@scope/a', '@scope/b'],
      selection: 'streamlined',
      groups: { core: { sync: 'linked', packages: ['@scope/*'] } },
      allPackageNames: ['@scope/a', '@scope/b', '@scope/shared'],
      ...over,
    });

    it('should repeat a shared prerequisite’s changelog under each owning unit', () => {
      const updates: VersionOutput['updates'] = [
        { packageName: '@scope/a', newVersion: '1.1.0', filePath: '', group: 'core' },
        { packageName: '@scope/b', newVersion: '1.1.0', filePath: '', group: 'core' },
        { packageName: '@scope/shared', newVersion: '1.1.0', filePath: '', group: 'core' },
      ];
      const render = makeRowChangelogRenderer([
        cl('@scope/a', [{ type: 'feat', description: 'A feature' }]),
        cl('@scope/b', [{ type: 'feat', description: 'B feature' }]),
        cl('@scope/shared', [{ type: 'fix', description: 'Shared fix' }]),
      ]);
      const region = renderSelectionRegion(updates, new Set(), cfg(), render);
      // The shared change is intentionally duplicated — each unit's pane is self-contained.
      expect(region.split('Shared fix').length - 1).toBe(2);
      // Each unit aggregates its primary plus the shared child.
      expect(region).toContain('A feature');
      expect(region).toContain('B feature');
    });
  });

  describe('scope demotion (#522)', () => {
    function output(over: Partial<VersionOutput>): VersionOutput {
      return { dryRun: false, updates: [], changelogs: [], tags: [], ...over };
    }

    // Deps bumps reach this surface as `type: 'changed'` (commitParser maps `chore(deps)` → changed),
    // so the bucket assertions here mirror the real pipeline: not demoted, they'd land under Changed.
    it('should demote deps-scoped entries into a trailing subsection while user-facing types stay', () => {
      const render = makeRowChangelogRenderer([
        cl('@scope/app', [
          { type: 'feat', description: 'App feature' },
          { type: 'changed', description: 'bump the npm-dependencies group', scope: 'deps' },
          { type: 'fix', description: 'App fix' },
        ]),
      ]);
      const block = render(['@scope/app'], false, '');
      // User-facing buckets keep their entries…
      expect(block).toContain('#### Added');
      expect(block).toContain('- App feature');
      expect(block).toContain('#### Fixed');
      expect(block).toContain('- App fix');
      // …and the deps entry is pulled out of Changed into its own subsection.
      expect(block).not.toContain('#### Changed');
      expect(block).toContain('#### Dependencies & version bumps');
      expect(block).toContain('- bump the npm-dependencies group');
      // The subsection trails every user-facing bucket.
      const demoted = block.indexOf('#### Dependencies & version bumps');
      expect(demoted).toBeGreaterThan(block.indexOf('#### Added'));
      expect(demoted).toBeGreaterThan(block.indexOf('#### Fixed'));
    });

    it('should give the demoted subsection a bare heading — no count, no descriptor', () => {
      const render = makeRowChangelogRenderer([
        cl('@scope/app', [{ type: 'changed', description: 'bump deps', scope: 'deps' }]),
      ]);
      const block = render(['@scope/app'], false, '');
      expect(block).toContain('#### Dependencies & version bumps');
      expect(block).not.toContain('Dependencies & version bumps (');
    });

    it('should still count demoted entries in the per-row (N entries) summary', () => {
      const render = makeRowChangelogRenderer([
        cl('@scope/app', [
          { type: 'feat', description: 'App feature' },
          { type: 'changed', description: 'bump deps', scope: 'deps' },
        ]),
      ]);
      const block = render(['@scope/app'], false, '');
      expect(block).toContain('Changelog (2 entries)');
    });

    it('should demote deps-scoped entries in the combined footer, count unchanged', () => {
      const footer = renderCombinedFooter(
        output({
          changelogs: [
            cl('@scope/a', [
              { type: 'feat', description: 'Real feature' },
              { type: 'changed', description: 'bump deps', scope: 'deps' },
            ]),
          ],
        }),
      );
      // Nothing removed — the demoted entry is still one of the de-duplicated changes.
      expect(footer).toContain('Show all changes (2 changes, de-duplicated)');
      expect(footer).toContain('#### Added');
      expect(footer).not.toContain('#### Changed');
      expect(footer).toContain('#### Dependencies & version bumps');
      expect(footer).toContain('- bump deps');
      expect(footer.indexOf('#### Dependencies & version bumps')).toBeGreaterThan(footer.indexOf('#### Added'));
    });

    it('should keep per-entry attribution on a demoted change shared across packages', () => {
      const shared = { type: 'changed', description: 'bump shared dep', scope: 'deps' } as const;
      const footer = renderCombinedFooter(output({ changelogs: [cl('@scope/a', [shared]), cl('@scope/b', [shared])] }));
      expect(footer).toContain('#### Dependencies & version bumps');
      // De-duplicated to one demoted line, attributed to both packages.
      expect(footer.split('bump shared dep').length - 1).toBe(1);
      expect(footer).toContain('_(a, b)_');
    });

    it('should render every scope inline when demoteScopes is empty', () => {
      const render = makeRowChangelogRenderer(
        [cl('@scope/app', [{ type: 'changed', description: 'bump deps', scope: 'deps' }])],
        'link',
        [],
      );
      const block = render(['@scope/app'], false, '');
      expect(block).not.toContain('Dependencies & version bumps');
      // Rendered inline in its normal type bucket, with its scope label.
      expect(block).toContain('#### Changed');
      expect(block).toContain('- bump deps (`deps`)');
    });

    it('should demote whichever scopes are configured', () => {
      const render = makeRowChangelogRenderer(
        [
          cl('@scope/app', [
            { type: 'feat', description: 'App feature' },
            { type: 'changed', description: 'retune workflow', scope: 'ci' },
          ]),
        ],
        'link',
        ['ci'],
      );
      const block = render(['@scope/app'], false, '');
      expect(block).toContain('#### Added');
      expect(block).toContain('#### Dependencies & version bumps');
      expect(block).toContain('- retune workflow');
      // The ci-scoped entry is demoted, so no Changed bucket remains.
      expect(block).not.toContain('#### Changed');
    });
  });
});
