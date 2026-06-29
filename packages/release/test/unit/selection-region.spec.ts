import type { VersionOutput } from '@releasekit/core';
import { describe, expect, it } from 'vitest';
import {
  cascadeDeselection,
  computeHierarchy,
  extractSelection,
  type PrimaryConfig,
  renderSelectionRegion,
  selectionWarnings,
  validatePrimaryPackages,
} from '../../src/standing-pr/selection-region.js';

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
    it('should warn when a deselected package partially splits an independent group', () => {
      const updates: Update[] = [
        { packageName: '@scope/a', newVersion: '1.1.0', filePath: '', group: 'g' },
        { packageName: '@scope/b', newVersion: '1.1.0', filePath: '', group: 'g' },
      ];
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

    it('should not warn about an independent group when every member is held back together', () => {
      const updates: Update[] = [
        { packageName: '@scope/a', newVersion: '1.1.0', filePath: '', group: 'g' },
        { packageName: '@scope/b', newVersion: '1.1.0', filePath: '', group: 'g' },
      ];
      // Whole group held (e.g. a primary cascade) is coherent — only a partial hold splits it.
      expect(
        selectionWarnings(updates, new Set(['@scope/a', '@scope/b']), { g: { sync: 'independent' } }),
      ).toHaveLength(0);
      expect(selectionWarnings(updates, new Set(['@scope/a']), { g: { sync: 'independent' } })).toHaveLength(1);
    });
  });

  // --- Hierarchical / release-unit selection (#464) ---

  describe('hierarchical selection (#464)', () => {
    const tauriGroups = { tauri: { sync: 'linked' as const, packages: ['@wdio/tauri-*', 'tauri-plugin-*'] } };
    const tauriAll = ['@wdio/tauri-service', '@wdio/tauri-plugin', 'tauri-plugin-wdio-webdriver'];
    const tauriUpdates: Update[] = [
      { packageName: '@wdio/tauri-service', newVersion: '1.4.0', filePath: '', group: 'tauri' },
      { packageName: '@wdio/tauri-plugin', newVersion: '1.4.0', filePath: '', group: 'tauri' },
      { packageName: 'tauri-plugin-wdio-webdriver', newVersion: '1.4.0', filePath: '', group: 'tauri' },
    ];
    const tauriChangelogs = tauriUpdates.map((u) => changelog(u.packageName, '1.3.0', '1.4.0'));
    const cfg = (over: Partial<PrimaryConfig> = {}): PrimaryConfig => ({
      primaryPackages: ['@wdio/tauri-service'],
      selection: 'streamlined',
      groups: tauriGroups,
      allPackageNames: tauriAll,
      ...over,
    });

    describe('computeHierarchy', () => {
      it('should nest a changed primary’s group-mates beneath it as children', () => {
        const h = computeHierarchy(tauriUpdates, cfg());
        expect(h.units).toHaveLength(1);
        expect(h.units[0]?.primaryName).toBe('@wdio/tauri-service');
        expect(h.units[0]?.primaryUpdate?.newVersion).toBe('1.4.0');
        expect(h.units[0]?.children.map((c) => c.packageName)).toEqual([
          '@wdio/tauri-plugin',
          'tauri-plugin-wdio-webdriver',
        ]);
        expect(h.orphans).toHaveLength(0);
      });

      it('should anchor an unchanged primary over its changed group-mate (linked common case)', () => {
        const pluginOnly: Update[] = [
          { packageName: '@wdio/tauri-plugin', newVersion: '1.4.0', filePath: '', group: 'tauri' },
        ];
        const h = computeHierarchy(pluginOnly, cfg());
        expect(h.units).toHaveLength(1);
        expect(h.units[0]?.primaryName).toBe('@wdio/tauri-service');
        expect(h.units[0]?.primaryUpdate).toBeUndefined();
        expect(h.units[0]?.children.map((c) => c.packageName)).toEqual(['@wdio/tauri-plugin']);
      });

      it('should nest a changed prerequisite beneath its primary target', () => {
        const updates: Update[] = [
          { packageName: '@scope/app', newVersion: '2.0.0', filePath: '' },
          {
            packageName: '@scope/core',
            newVersion: '1.1.0',
            filePath: '',
            role: 'prerequisite',
            prerequisiteOf: ['@scope/app'],
          },
        ];
        const h = computeHierarchy(updates, {
          primaryPackages: ['@scope/app'],
          selection: 'streamlined',
          groups: {},
          allPackageNames: ['@scope/app', '@scope/core'],
        });
        expect(h.units[0]?.children.map((c) => c.packageName)).toEqual(['@scope/core']);
      });

      it('should keep two primaries peer and reference-count their shared child', () => {
        const updates: Update[] = [
          { packageName: '@scope/a', newVersion: '1.1.0', filePath: '', group: 'core' },
          { packageName: '@scope/b', newVersion: '1.1.0', filePath: '', group: 'core' },
          { packageName: '@scope/shared', newVersion: '1.1.0', filePath: '', group: 'core' },
        ];
        const h = computeHierarchy(updates, {
          primaryPackages: ['@scope/a', '@scope/b'],
          selection: 'streamlined',
          groups: { core: { sync: 'linked', packages: ['@scope/*'] } },
          allPackageNames: ['@scope/a', '@scope/b', '@scope/shared'],
        });
        expect(h.units.map((u) => u.primaryName)).toEqual(['@scope/a', '@scope/b']);
        // Each primary lists the shared child but NOT the other primary (peers stay top-level).
        expect(h.units[0]?.children.map((c) => c.packageName)).toEqual(['@scope/shared']);
        expect(h.units[1]?.children.map((c) => c.packageName)).toEqual(['@scope/shared']);
        expect(h.childOwners.get('@scope/shared')).toEqual(['@scope/a', '@scope/b']);
      });

      it('should leave a changed package that is neither primary nor child as a flat orphan', () => {
        const updates: Update[] = [...tauriUpdates, { packageName: '@scope/loner', newVersion: '3.0.0', filePath: '' }];
        const h = computeHierarchy(updates, cfg({ allPackageNames: [...tauriAll, '@scope/loner'] }));
        expect(h.orphans.map((o) => o.packageName)).toEqual(['@scope/loner']);
        expect(h.units).toHaveLength(1);
      });
    });

    describe('cascadeDeselection', () => {
      it('should hold back a single-owner primary’s whole closure', () => {
        const h = computeHierarchy(tauriUpdates, cfg());
        expect([...cascadeDeselection(h, new Set(['@wdio/tauri-service']))].sort()).toEqual([
          '@wdio/tauri-plugin',
          '@wdio/tauri-service',
          'tauri-plugin-wdio-webdriver',
        ]);
      });

      it('should hold a shared child only when every owning primary is deselected', () => {
        const updates: Update[] = [
          { packageName: '@scope/a', newVersion: '1.1.0', filePath: '', group: 'core' },
          { packageName: '@scope/b', newVersion: '1.1.0', filePath: '', group: 'core' },
          { packageName: '@scope/shared', newVersion: '1.1.0', filePath: '', group: 'core' },
        ];
        const h = computeHierarchy(updates, {
          primaryPackages: ['@scope/a', '@scope/b'],
          selection: 'streamlined',
          groups: { core: { sync: 'linked', packages: ['@scope/*'] } },
          allPackageNames: ['@scope/a', '@scope/b', '@scope/shared'],
        });
        // Only one owner held → shared keeps releasing.
        expect([...cascadeDeselection(h, new Set(['@scope/a']))].sort()).toEqual(['@scope/a']);
        // Both owners held → shared held too.
        expect([...cascadeDeselection(h, new Set(['@scope/a', '@scope/b']))].sort()).toEqual([
          '@scope/a',
          '@scope/b',
          '@scope/shared',
        ]);
      });

      it('should pass a deselected orphan straight through', () => {
        const updates: Update[] = [...tauriUpdates, { packageName: '@scope/loner', newVersion: '3.0.0', filePath: '' }];
        const h = computeHierarchy(updates, cfg({ allPackageNames: [...tauriAll, '@scope/loner'] }));
        expect([...cascadeDeselection(h, new Set(['@scope/loner']))]).toEqual(['@scope/loner']);
      });

      it('should escalate a legacy directly-held child to holding its whole unit (transition fail-safe)', () => {
        // First run after primaryPackages is enabled, a child unticked in the old flat body arrives
        // here directly — it must hold its whole unit so the held-back package never silently ships.
        const h = computeHierarchy(tauriUpdates, cfg());
        expect([...cascadeDeselection(h, new Set(['@wdio/tauri-plugin']))].sort()).toEqual([
          '@wdio/tauri-plugin',
          '@wdio/tauri-service',
          'tauri-plugin-wdio-webdriver',
        ]);
      });
    });

    describe('renderSelectionRegion (hierarchical)', () => {
      it('should render a streamlined primary with read-only coupled bullets in a collapsed pane', () => {
        const region = renderSelectionRegion(mockOutput(tauriUpdates, tauriChangelogs), tauriUpdates, new Set(), cfg());
        expect(region).toContain('- [x] **`@wdio/tauri-service`** → 1.4.0 (minor) <!-- rk-sel:@wdio/tauri-service -->');
        expect(region).toContain('  <details><summary>ships 2 coupled</summary>');
        expect(region).toContain('  - `@wdio/tauri-plugin` → 1.4.0 (minor) · coupled');
        expect(region).toContain('  - `tauri-plugin-wdio-webdriver` → 1.4.0 (minor) · coupled');
        expect(region).toContain('  </details>');
        // Children are never task items and carry no marker — their state is derived, not toggled.
        expect(region).not.toContain('[x] `@wdio/tauri-plugin`');
        expect(region).not.toContain('rk-sel:@wdio/tauri-plugin');
      });

      it('should render an unchanged primary as "— no change" but still toggleable', () => {
        const pluginOnly: Update[] = [
          { packageName: '@wdio/tauri-plugin', newVersion: '1.4.0', filePath: '', group: 'tauri' },
        ];
        const region = renderSelectionRegion(mockOutput(pluginOnly), pluginOnly, new Set(), cfg());
        expect(region).toContain('- [x] **`@wdio/tauri-service`** — no change <!-- rk-sel:@wdio/tauri-service -->');
      });

      it('should give every package its own marker’d checkbox in granular mode, no <details>', () => {
        const region = renderSelectionRegion(
          mockOutput(tauriUpdates, tauriChangelogs),
          tauriUpdates,
          new Set(),
          cfg({ selection: 'granular' }),
        );
        expect(region).toContain('- [x] **`@wdio/tauri-service`** → 1.4.0 (minor) <!-- rk-sel:@wdio/tauri-service -->');
        expect(region).toContain('  - [x] `@wdio/tauri-plugin` → 1.4.0 (minor) <!-- rk-sel:@wdio/tauri-plugin -->');
        expect(region).not.toContain('<details>');
      });

      it('should render byte-for-byte the flat list when primaryPackages is empty (back-compat)', () => {
        const updates: Update[] = [
          { packageName: '@scope/a', newVersion: '1.1.0', filePath: '' },
          { packageName: '@scope/b', newVersion: '2.0.0', filePath: '' },
        ];
        const flat = renderSelectionRegion(mockOutput(updates), updates, new Set());
        const withEmpty = renderSelectionRegion(mockOutput(updates), updates, new Set(), {
          primaryPackages: [],
          selection: 'streamlined',
          groups: {},
          allPackageNames: [],
        });
        expect(withEmpty).toBe(flat);
      });
    });

    describe('validatePrimaryPackages', () => {
      it('should warn when an entry matches no known package', () => {
        const warnings = validatePrimaryPackages(['@scope/ghost'], ['@scope/a'], []);
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain('matches no known package');
      });

      it('should warn when an entry matches a version.skip package', () => {
        const warnings = validatePrimaryPackages(['@scope/a'], ['@scope/a'], ['@scope/a']);
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain('version.skip excludes');
      });

      it('should not warn for an entry that matches a real, non-skipped package', () => {
        expect(validatePrimaryPackages(['@scope/a'], ['@scope/a', '@scope/b'], [])).toEqual([]);
      });
    });

    it('should round-trip a primary untick through render → extract → cascade (children excluded)', () => {
      const seeded = renderSelectionRegion(mockOutput(tauriUpdates, tauriChangelogs), tauriUpdates, new Set(), cfg());
      const edited = seeded.replace('[x] **`@wdio/tauri-service`**', '[ ] **`@wdio/tauri-service`**');
      const extracted = extractSelection(`## Release\n\n${edited}`);
      expect(extracted?.deselected).toEqual(['@wdio/tauri-service']);

      const hierarchy = computeHierarchy(tauriUpdates, cfg());
      const effective = cascadeDeselection(hierarchy, new Set(extracted?.deselected));
      expect([...effective].sort()).toEqual([
        '@wdio/tauri-plugin',
        '@wdio/tauri-service',
        'tauri-plugin-wdio-webdriver',
      ]);
    });
  });
});
