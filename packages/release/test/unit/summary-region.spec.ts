import type { VersionOutput } from '@releasekit/core';
import { describe, expect, it } from 'vitest';
import { renderReleaseSummaryLine, renderVersionSummaryTable } from '../../src/standing-pr/summary-region.js';

type Update = VersionOutput['updates'][number];
type Changelog = VersionOutput['changelogs'][number];

function vo(updates: Update[], changelogs: Changelog[] = []): VersionOutput {
  return { dryRun: false, strategy: 'async', updates, changelogs, tags: [] };
}

/** A changelog whose distinct entry descriptions drive the de-duplicated change count. */
function cl(packageName: string, entries: { type: string; description: string }[]): Changelog {
  return { packageName, version: '', previousVersion: null, revisionRange: '', repoUrl: null, entries };
}

describe('summary-region', () => {
  describe('renderReleaseSummaryLine', () => {
    it('should render the package count, mixed-channel split, change count, and held-back clause', () => {
      const updates: Update[] = [
        { packageName: '@scope/a', newVersion: '1.2.0', filePath: '', channel: 'stable', previousVersion: 'v1.1.0' },
        { packageName: '@scope/b', newVersion: '2.1.0', filePath: '', channel: 'stable', previousVersion: 'v2.0.5' },
        {
          packageName: '@scope/c',
          newVersion: '1.0.0-next.4',
          filePath: '',
          channel: 'prerelease',
          previousVersion: 'v1.0.0-next.3',
        },
      ];
      const changelogs = [
        cl('@scope/a', [
          { type: 'feat', description: 'A1' },
          { type: 'fix', description: 'A2' },
        ]),
        cl('@scope/b', [{ type: 'feat', description: 'B1' }]),
        cl('@scope/c', [{ type: 'feat', description: 'C1' }]),
      ];

      const line = renderReleaseSummaryLine(vo(updates, changelogs), { heldBackCount: 2 });

      expect(line).toBe(
        '**3 packages** will publish — 2 stable · 1 prerelease · 4 changes. No major bumps. 2 held back.',
      );
    });

    it('should omit the channel split for a single-channel release', () => {
      const updates: Update[] = [
        { packageName: '@scope/a', newVersion: '1.2.0', filePath: '', channel: 'stable', previousVersion: 'v1.1.0' },
        { packageName: '@scope/b', newVersion: '2.1.0', filePath: '', channel: 'stable', previousVersion: 'v2.0.0' },
      ];
      const changelogs = [
        cl('@scope/a', [
          { type: 'feat', description: 'A1' },
          { type: 'fix', description: 'A2' },
        ]),
        cl('@scope/b', [{ type: 'feat', description: 'B1' }]),
      ];

      const line = renderReleaseSummaryLine(vo(updates, changelogs), { heldBackCount: 0 });

      expect(line).toBe('**2 packages** will publish — 3 changes. No major bumps.');
    });

    it('should flag a major bump with a warning and pluralize a lone package and change', () => {
      const updates: Update[] = [
        { packageName: '@scope/a', newVersion: '2.0.0', filePath: '', channel: 'stable', previousVersion: 'v1.5.0' },
      ];
      const changelogs = [cl('@scope/a', [{ type: 'feat', description: 'Breaking rework' }])];

      const line = renderReleaseSummaryLine(vo(updates, changelogs), { heldBackCount: 0 });

      expect(line).toBe('**1 package** will publish — 1 change. ⚠️ 1 major bump.');
    });

    it('should count a premajor prerelease as a major bump', () => {
      const updates: Update[] = [
        {
          packageName: '@scope/a',
          newVersion: '2.0.0-next.0',
          filePath: '',
          channel: 'prerelease',
          previousVersion: 'v1.5.0',
        },
      ];
      const changelogs = [
        cl('@scope/a', [
          { type: 'feat', description: 'Breaking rework' },
          { type: 'fix', description: 'A2' },
        ]),
      ];

      const line = renderReleaseSummaryLine(vo(updates, changelogs), { heldBackCount: 0 });

      expect(line).toBe('**1 package** will publish — 2 changes. ⚠️ 1 major bump.');
    });

    it('should count multiple major bumps and multiple held-back packages', () => {
      const updates: Update[] = [
        { packageName: '@scope/a', newVersion: '2.0.0', filePath: '', channel: 'stable', previousVersion: 'v1.0.0' },
        { packageName: '@scope/b', newVersion: '3.0.0', filePath: '', channel: 'stable', previousVersion: 'v2.0.0' },
      ];
      const changelogs = [
        cl('@scope/a', [{ type: 'feat', description: 'A1' }]),
        cl('@scope/b', [{ type: 'feat', description: 'B1' }]),
      ];

      const line = renderReleaseSummaryLine(vo(updates, changelogs), { heldBackCount: 5 });

      expect(line).toBe('**2 packages** will publish — 2 changes. ⚠️ 2 major bumps. 5 held back.');
    });

    it('should tolerate an absent previousVersion — it never counts as a major bump', () => {
      const updates: Update[] = [{ packageName: '@scope/a', newVersion: '2.0.0', filePath: '', channel: 'stable' }];
      const changelogs = [cl('@scope/a', [{ type: 'feat', description: 'A1' }])];

      const line = renderReleaseSummaryLine(vo(updates, changelogs), { heldBackCount: 0 });

      expect(line).toBe('**1 package** will publish — 1 change. No major bumps.');
    });

    it('should derive the channel from the version when the channel field is absent (old manifest)', () => {
      const updates: Update[] = [
        { packageName: '@scope/a', newVersion: '1.2.0', filePath: '', previousVersion: 'v1.1.0' },
        { packageName: '@scope/b', newVersion: '1.0.0-rc.1', filePath: '', previousVersion: 'v1.0.0-rc.0' },
      ];
      const changelogs = [
        cl('@scope/a', [{ type: 'feat', description: 'A1' }]),
        cl('@scope/b', [{ type: 'fix', description: 'B1' }]),
      ];

      const line = renderReleaseSummaryLine(vo(updates, changelogs), { heldBackCount: 0 });

      expect(line).toBe('**2 packages** will publish — 1 stable · 1 prerelease · 2 changes. No major bumps.');
    });
  });

  describe('renderVersionSummaryTable', () => {
    it('should render a header and one row per publishing package with current, next, bump, and tag', () => {
      const updates: Update[] = [
        {
          packageName: '@wdio/electron-service',
          newVersion: '10.2.0',
          filePath: '',
          channel: 'stable',
          previousVersion: 'v10.1.0',
        },
        {
          packageName: '@wdio/dioxus-service',
          newVersion: '1.0.0-next.4',
          filePath: '',
          channel: 'prerelease',
          previousVersion: 'v1.0.0-next.3',
        },
      ];

      const table = renderVersionSummaryTable(vo(updates));

      expect(table).toContain('<details><summary>Version summary (2 packages)</summary>');
      expect(table).toContain('| Package | Current | Next | Bump | Tag |');
      expect(table).toContain('| --- | --- | --- | --- | --- |');
      expect(table).toContain('| `@wdio/electron-service` | 10.1.0 | 10.2.0 | minor | latest |');
      expect(table).toContain('| `@wdio/dioxus-service` | 1.0.0-next.3 | 1.0.0-next.4 | prerelease | next |');
      expect(table).toContain('</details>');
    });

    it('should show a dash for the Current column and derive a coarse Bump when the baseline is absent', () => {
      const updates: Update[] = [
        {
          packageName: '@scope/new',
          newVersion: '1.0.0',
          filePath: '',
          channel: 'stable',
          action: 'first-release',
        },
        { packageName: '@scope/pre', newVersion: '0.1.0-next.0', filePath: '', channel: 'prerelease' },
        { packageName: '@scope/plain', newVersion: '1.0.1', filePath: '', channel: 'stable' },
      ];

      const table = renderVersionSummaryTable(vo(updates));

      expect(table).toContain('| `@scope/new` | — | 1.0.0 | first release | latest |');
      expect(table).toContain('| `@scope/pre` | — | 0.1.0-next.0 | prerelease | next |');
      expect(table).toContain('| `@scope/plain` | — | 1.0.1 | — | latest |');
    });

    it('should strip a scoped consumer-tag prefix from the baseline in the Current column', () => {
      const updates: Update[] = [
        {
          packageName: '@scope/pkg',
          newVersion: '1.1.0',
          filePath: '',
          channel: 'stable',
          previousVersion: '@scope/pkg@v1.0.0',
        },
      ];

      const table = renderVersionSummaryTable(vo(updates));

      expect(table).toContain('| `@scope/pkg` | 1.0.0 | 1.1.0 | minor | latest |');
    });

    it('should exclude the root lockstep bump and count only publishable packages', () => {
      const updates: Update[] = [
        { packageName: 'root', newVersion: '1.2.0', filePath: '', isRoot: true, previousVersion: 'v1.1.0' },
        { packageName: '@scope/a', newVersion: '1.2.0', filePath: '', channel: 'stable', previousVersion: 'v1.1.0' },
      ];

      const table = renderVersionSummaryTable(vo(updates));

      expect(table).toContain('<details><summary>Version summary (1 package)</summary>');
      expect(table).not.toContain('`root`');
      expect(table).toContain('| `@scope/a` | 1.1.0 | 1.2.0 | minor | latest |');
    });

    it('should return an empty string when there is nothing to publish', () => {
      expect(renderVersionSummaryTable(vo([]))).toBe('');
    });
  });
});
