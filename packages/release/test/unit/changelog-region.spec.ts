import type { VersionOutput } from '@releasekit/core';
import { describe, expect, it } from 'vitest';
import { makeRowChangelogRenderer, renderCombinedFooter } from '../../src/standing-pr/changelog-region.js';
import { type PrimaryConfig, renderSelectionRegion } from '../../src/standing-pr/selection-region.js';

type Changelog = VersionOutput['changelogs'][number];

function cl(packageName: string, entries: Changelog['entries']): Changelog {
  return { packageName, version: '1.0.0', previousVersion: '0.9.0', revisionRange: '', repoUrl: null, entries };
}

describe('changelog-region', () => {
  describe('makeRowChangelogRenderer', () => {
    it('should aggregate a unit’s primary and coupled members into one collapsed pane', () => {
      const render = makeRowChangelogRenderer([
        cl('@scope/app', [{ type: 'feat', description: 'App feature' }]),
        cl('@scope/lib', [{ type: 'fix', description: 'Lib fix' }]),
      ]);
      const block = render(['@scope/app', '@scope/lib'], false, '  ');
      // One <details> covering both packages, grouped by Keep-a-Changelog type.
      expect(block).toContain('  <details><summary>Changelog (2 entries)</summary>');
      expect(block).toContain('  **Added**');
      expect(block).toContain('  - App feature');
      expect(block).toContain('  **Fixed**');
      expect(block).toContain('  - Lib fix');
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

    it('should fold project-wide shared entries into the flat type buckets', () => {
      const footer = renderCombinedFooter(
        output({
          changelogs: [cl('@scope/a', [{ type: 'feat', description: 'Package feature' }])],
          sharedEntries: [{ type: 'fix', description: 'CI tweak' }],
        }),
      );
      expect(footer).toContain('**Added**');
      expect(footer).toContain('- Package feature');
      expect(footer).toContain('**Fixed**');
      expect(footer).toContain('- CI tweak');
      expect(footer).toContain('Show all changes (2 changes, de-duplicated)');
    });

    it('should return empty string when there are no real entries', () => {
      expect(renderCombinedFooter(output({ changelogs: [cl('@scope/a', [])] }))).toBe('');
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
});
