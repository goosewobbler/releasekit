import type { VersionOutput } from '@releasekit/core';
import { describe, expect, it } from 'vitest';
import { extractSelection, renderSelectionRegion, selectionWarnings } from '../../src/standing-pr/selection-region.js';

type Update = VersionOutput['updates'][number];

function mockOutput(updates: Update[], changelogs: VersionOutput['changelogs'] = []): VersionOutput {
  return {
    dryRun: true,
    strategy: 'async',
    updates,
    changelogs,
    tags: [],
    commitMessage: '',
    sharedEntries: [],
  } as unknown as VersionOutput;
}

function changelog(packageName: string, previousVersion: string, version: string) {
  return { packageName, version, previousVersion, revisionRange: '', repoUrl: null, entries: [] };
}

describe('selection-region', () => {
  describe('renderSelectionRegion', () => {
    it('should render every package ticked by default with a per-row identity marker', () => {
      const updates: Update[] = [
        { packageName: '@scope/a', newVersion: '1.1.0', filePath: '' },
        { packageName: '@scope/b', newVersion: '2.0.0', filePath: '' },
      ];
      const region = renderSelectionRegion(mockOutput(updates), updates, new Set());

      expect(region).toContain('- [x] `@scope/a` → 1.1.0 <!-- rk-sel:@scope/a -->');
      expect(region).toContain('- [x] `@scope/b` → 2.0.0 <!-- rk-sel:@scope/b -->');
      expect(region).toContain('<!-- releasekit-selection -->');
      expect(region).toContain('<!-- releasekit-selection-end -->');
    });

    it('should untick rows for deselected packages', () => {
      const updates: Update[] = [
        { packageName: '@scope/a', newVersion: '1.1.0', filePath: '' },
        { packageName: '@scope/b', newVersion: '2.0.0', filePath: '' },
      ];
      const region = renderSelectionRegion(mockOutput(updates), updates, new Set(['@scope/b']));

      expect(region).toContain('- [x] `@scope/a` → 1.1.0 <!-- rk-sel:@scope/a -->');
      expect(region).toContain('- [ ] `@scope/b` → 2.0.0 <!-- rk-sel:@scope/b -->');
    });

    it('should show the commit-driven bump kind when the previous version is known', () => {
      const updates: Update[] = [{ packageName: '@scope/a', newVersion: '1.1.0', filePath: '' }];
      const region = renderSelectionRegion(
        mockOutput(updates, [changelog('@scope/a', '1.0.0', '1.1.0')]),
        updates,
        new Set(),
      );
      expect(region).toContain('→ 1.1.0 (minor)');
    });

    it('should not crash and still derive the bump kind from a package-specific tag previousVersion', () => {
      // packageSpecificTags repos carry previousVersion as a full tag (`name@vX.Y.Z`) — a bare
      // semver.diff throws "Invalid Version" and would abort the whole render (regression #NNN).
      const updates: Update[] = [{ packageName: 'wdio-electron-cdp-bridge', newVersion: '10.1.0', filePath: '' }];
      const region = renderSelectionRegion(
        mockOutput(updates, [changelog('wdio-electron-cdp-bridge', 'wdio-electron-cdp-bridge@v10.0.0', '10.1.0')]),
        updates,
        new Set(),
      );
      expect(region).toContain('→ 10.1.0 (minor)');
    });

    it('should drop the suffix rather than throw on an unparseable previousVersion', () => {
      const updates: Update[] = [{ packageName: 'pkg', newVersion: '1.1.0', filePath: '' }];
      const region = renderSelectionRegion(
        mockOutput(updates, [changelog('pkg', 'not-a-version', '1.1.0')]),
        updates,
        new Set(),
      );
      expect(region).toContain('→ 1.1.0');
      expect(region).not.toContain('(');
    });

    it('should group targets above their derived prerequisites', () => {
      const updates: Update[] = [
        { packageName: '@scope/app', newVersion: '2.0.0', filePath: '', role: 'target' },
        {
          packageName: '@scope/core',
          newVersion: '1.1.0',
          filePath: '',
          role: 'prerequisite',
          prerequisiteOf: ['@scope/app'],
        },
      ];
      const region = renderSelectionRegion(mockOutput(updates), updates, new Set());

      expect(region).toContain('- [x] **`@scope/app`** → 2.0.0 <!-- rk-sel:@scope/app -->');
      expect(region).toContain('  - [x] ↳ prerequisite `@scope/core` → 1.1.0 <!-- rk-sel:@scope/core -->');
    });

    it('should list a prerequisite whose target has no update entry rather than drop it', () => {
      // @scope/app (the target) had no change of its own, so only its prerequisite is in updates.
      const updates: Update[] = [
        {
          packageName: '@scope/core',
          newVersion: '1.1.0',
          filePath: '',
          role: 'prerequisite',
          prerequisiteOf: ['@scope/app'],
        },
      ];
      const region = renderSelectionRegion(mockOutput(updates), updates, new Set());

      expect(region).toContain('rk-sel:@scope/core');
    });
  });

  describe('extractSelection', () => {
    it('should return undefined when no selection region is present', () => {
      expect(extractSelection('## Release\n\nno region here')).toBeUndefined();
    });

    it('should report unticked rows as deselected and ticked rows as selected', () => {
      const updates: Update[] = [
        { packageName: '@scope/a', newVersion: '1.1.0', filePath: '' },
        { packageName: '@scope/b', newVersion: '2.0.0', filePath: '' },
      ];
      const body = `## Release\n\n${renderSelectionRegion(mockOutput(updates), updates, new Set(['@scope/b']))}\n\nchangelog`;

      expect(extractSelection(body)).toEqual({ deselected: ['@scope/b'] });
    });

    it('should take package identity from the marker, not the edited display text', () => {
      // A maintainer mangles the visible label but leaves the marker — identity must follow the marker.
      const body = `<!-- releasekit-selection -->\n\n- [ ] \`whatever the human typed\` <!-- rk-sel:@scope/real -->\n\n<!-- releasekit-selection-end -->`;
      expect(extractSelection(body)).toEqual({ deselected: ['@scope/real'] });
    });

    it('should round-trip a deselection through render → extract → render (merge-preserve)', () => {
      const updates: Update[] = [
        { packageName: '@scope/a', newVersion: '1.1.0', filePath: '' },
        { packageName: '@scope/b', newVersion: '2.0.0', filePath: '' },
      ];
      // First render all-ticked, simulate the human unticking b, then re-render from the extracted set.
      const seeded = renderSelectionRegion(mockOutput(updates), updates, new Set());
      const edited = seeded.replace('[x] `@scope/b`', '[ ] `@scope/b`');
      const extracted = extractSelection(edited);
      const rerendered = renderSelectionRegion(mockOutput(updates), updates, new Set(extracted?.deselected));

      expect(rerendered).toContain('- [ ] `@scope/b`');
      expect(rerendered).toContain('- [x] `@scope/a`');
    });
  });

  describe('selectionWarnings', () => {
    it('should warn when a deselected package is an independent-group member', () => {
      const updates: Update[] = [{ packageName: '@scope/a', newVersion: '1.1.0', filePath: '', group: 'g' }];
      const warnings = selectionWarnings(updates, new Set(['@scope/a']), { g: { sync: 'independent' } });

      expect(warnings).toHaveLength(1);
      expect(warnings[0]?.reason).toContain('independent group');
    });

    it('should warn when a deselected prerequisite is still needed by a selected target', () => {
      const updates: Update[] = [
        { packageName: '@scope/app', newVersion: '2.0.0', filePath: '', role: 'target' },
        {
          packageName: '@scope/core',
          newVersion: '1.1.0',
          filePath: '',
          role: 'prerequisite',
          prerequisiteOf: ['@scope/app'],
        },
      ];
      const warnings = selectionWarnings(updates, new Set(['@scope/core']), {});

      expect(warnings).toHaveLength(1);
      expect(warnings[0]?.reason).toContain('prerequisite of still-selected');
    });

    it('should not warn when the prerequisite and all its targets are deselected together', () => {
      const updates: Update[] = [
        { packageName: '@scope/app', newVersion: '2.0.0', filePath: '', role: 'target' },
        {
          packageName: '@scope/core',
          newVersion: '1.1.0',
          filePath: '',
          role: 'prerequisite',
          prerequisiteOf: ['@scope/app'],
        },
      ];
      const warnings = selectionWarnings(updates, new Set(['@scope/app', '@scope/core']), {});

      expect(warnings).toHaveLength(0);
    });
  });
});
