import type { VersionOutput } from '@releasekit/core';
import { describe, expect, it } from 'vitest';
import {
  type ChannelToggleConfig,
  cascadeDeselection,
  computeHierarchy,
  extractChannelSelection,
  extractSelection,
  type PrimaryConfig,
  renderSelectionRegion,
  resolveChannelConflicts,
  selectionWarnings,
  validatePrimaryPackages,
} from '../../src/standing-pr/selection-region.js';

type Update = VersionOutput['updates'][number];

describe('selection-region', () => {
  describe('renderSelectionRegion', () => {
    it('should render every package ticked by default with a per-row identity marker', () => {
      const updates: Update[] = [
        { packageName: '@scope/a', newVersion: '1.1.0', filePath: '' },
        { packageName: '@scope/b', newVersion: '2.0.0', filePath: '' },
      ];
      const region = renderSelectionRegion(updates, new Set());

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
      const region = renderSelectionRegion(updates, new Set(['@scope/b']));

      expect(region).toContain('- [x] `@scope/a` → 1.1.0 <!-- rk-sel:@scope/a -->');
      expect(region).toContain('- [ ] `@scope/b` → 2.0.0 <!-- rk-sel:@scope/b -->');
    });

    it('should render a plain `→ version` row with no bump-kind parenthetical', () => {
      const updates: Update[] = [{ packageName: '@scope/a', newVersion: '1.1.0', filePath: '' }];
      const region = renderSelectionRegion(updates, new Set());
      expect(region).toContain('→ 1.1.0');
      expect(region).not.toContain('(minor)');
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
      const region = renderSelectionRegion(updates, new Set());

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
      const region = renderSelectionRegion(updates, new Set());

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
      const body = `## Release\n\n${renderSelectionRegion(updates, new Set(['@scope/b']))}\n\nchangelog`;

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
      const seeded = renderSelectionRegion(updates, new Set());
      const edited = seeded.replace('[x] `@scope/b`', '[ ] `@scope/b`');
      const extracted = extractSelection(edited);
      const rerendered = renderSelectionRegion(updates, new Set(extracted?.deselected));

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

  describe('hierarchical selection', () => {
    const tauriGroups = { tauri: { sync: 'linked' as const, packages: ['@wdio/tauri-*', 'tauri-plugin-*'] } };
    const tauriAll = ['@wdio/tauri-service', '@wdio/tauri-plugin', 'tauri-plugin-wdio-webdriver'];
    const tauriUpdates: Update[] = [
      { packageName: '@wdio/tauri-service', newVersion: '1.4.0', filePath: '', group: 'tauri' },
      { packageName: '@wdio/tauri-plugin', newVersion: '1.4.0', filePath: '', group: 'tauri' },
      { packageName: 'tauri-plugin-wdio-webdriver', newVersion: '1.4.0', filePath: '', group: 'tauri' },
    ];
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
        const region = renderSelectionRegion(tauriUpdates, new Set(), cfg());
        expect(region).toContain('- [x] **`@wdio/tauri-service`** → 1.4.0 <!-- rk-sel:@wdio/tauri-service -->');
        expect(region).toContain('  <details><summary>ships 2 coupled</summary>');
        expect(region).toContain('  - `@wdio/tauri-plugin` → 1.4.0 · coupled');
        expect(region).toContain('  - `tauri-plugin-wdio-webdriver` → 1.4.0 · coupled');
        expect(region).toContain('  </details>');
        // Children are never task items and carry no marker — their state is derived, not toggled.
        expect(region).not.toContain('[x] `@wdio/tauri-plugin`');
        expect(region).not.toContain('rk-sel:@wdio/tauri-plugin');
      });

      it('should label independent-group members "bundled" rather than "coupled"', () => {
        // independent members version on their own commit-driven lines but ship atomically with the
        // unit — "coupled" implies a shared version they don't have; "bundled" conveys atomic shipping.
        const independent = { tauri: { sync: 'independent' as const, packages: ['@wdio/tauri-*', 'tauri-plugin-*'] } };
        const region = renderSelectionRegion(tauriUpdates, new Set(), cfg({ groups: independent }));
        expect(region).toContain('  <details><summary>ships 2 bundled</summary>');
        expect(region).toContain('  - `@wdio/tauri-plugin` → 1.4.0 · bundled');
        expect(region).toContain('  - `tauri-plugin-wdio-webdriver` → 1.4.0 · bundled');
        expect(region).not.toContain('· coupled');
      });

      it('should keep an independent primary’s prerequisite as "coupled", not "bundled"', () => {
        // A prerequisite ships with the unit but isn't a group member — it has no version-bundle with
        // the independent group, so it keeps `coupled` even while the true group member shows `bundled`.
        const independent = { tauri: { sync: 'independent' as const, packages: ['@wdio/tauri-*', 'tauri-plugin-*'] } };
        const updates: Update[] = [
          { packageName: '@wdio/tauri-service', newVersion: '1.4.0', filePath: '', group: 'tauri' },
          { packageName: '@wdio/tauri-plugin', newVersion: '1.4.0', filePath: '', group: 'tauri' },
          {
            packageName: '@scope/prereq',
            newVersion: '2.0.0',
            filePath: '',
            role: 'prerequisite',
            prerequisiteOf: ['@wdio/tauri-service'],
          },
        ];
        const region = renderSelectionRegion(
          updates,
          new Set(),
          cfg({ groups: independent, allPackageNames: [...tauriAll, '@scope/prereq'] }),
        );
        expect(region).toContain('  - `@wdio/tauri-plugin` → 1.4.0 · bundled');
        expect(region).toContain('  - `@scope/prereq` → 2.0.0 · coupled');
      });

      it('should render an unchanged primary as "— no change" but still toggleable', () => {
        const pluginOnly: Update[] = [
          { packageName: '@wdio/tauri-plugin', newVersion: '1.4.0', filePath: '', group: 'tauri' },
        ];
        const region = renderSelectionRegion(pluginOnly, new Set(), cfg());
        expect(region).toContain('- [x] **`@wdio/tauri-service`** — no change <!-- rk-sel:@wdio/tauri-service -->');
      });

      it('should give every package its own marker’d checkbox in granular mode, no <details>', () => {
        const region = renderSelectionRegion(tauriUpdates, new Set(), cfg({ selection: 'granular' }));
        expect(region).toContain('- [x] **`@wdio/tauri-service`** → 1.4.0 <!-- rk-sel:@wdio/tauri-service -->');
        expect(region).toContain('  - [x] `@wdio/tauri-plugin` → 1.4.0 <!-- rk-sel:@wdio/tauri-plugin -->');
        expect(region).not.toContain('<details>');
      });

      it('should render byte-for-byte the flat list when primaryPackages is empty (back-compat)', () => {
        const updates: Update[] = [
          { packageName: '@scope/a', newVersion: '1.1.0', filePath: '' },
          { packageName: '@scope/b', newVersion: '2.0.0', filePath: '' },
        ];
        const flat = renderSelectionRegion(updates, new Set());
        const withEmpty = renderSelectionRegion(updates, new Set(), {
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
      const seeded = renderSelectionRegion(tauriUpdates, new Set(), cfg());
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

  // --- Channel-grouped sections (#487) ---

  describe('channel-grouped sections', () => {
    const STABLE = '#### Stable — advancing on `latest`';
    const PRERELEASE = '#### Prereleases — advancing on their pre-release dist-tag';

    it('should split a mixed PR into a Stable then a Prereleases section', () => {
      const updates: Update[] = [
        { packageName: '@scope/a', newVersion: '1.1.0', filePath: '', channel: 'stable' },
        { packageName: '@scope/b', newVersion: '2.0.0-next.1', filePath: '', channel: 'prerelease' },
      ];
      const region = renderSelectionRegion(updates, new Set());

      expect(region).toContain(STABLE);
      expect(region).toContain(PRERELEASE);
      // Stable section precedes the prerelease section, and each row sits under its own heading.
      expect(region.indexOf(STABLE)).toBeLessThan(region.indexOf(PRERELEASE));
      expect(region.indexOf(STABLE)).toBeLessThan(region.indexOf('rk-sel:@scope/a'));
      expect(region.indexOf('rk-sel:@scope/a')).toBeLessThan(region.indexOf(PRERELEASE));
      expect(region.indexOf(PRERELEASE)).toBeLessThan(region.indexOf('rk-sel:@scope/b'));
    });

    it('should surface the target version and dist-tag channel on each prerelease row', () => {
      const updates: Update[] = [
        { packageName: '@scope/a', newVersion: '1.1.0', filePath: '', channel: 'stable' },
        { packageName: '@scope/b', newVersion: '2.0.0-next.1', filePath: '', channel: 'prerelease' },
        { packageName: '@scope/c', newVersion: '3.0.0-beta.4', filePath: '', channel: 'prerelease' },
      ];
      const region = renderSelectionRegion(updates, new Set());

      expect(region).toContain('- [x] `@scope/a` → 1.1.0 <!-- rk-sel:@scope/a -->');
      expect(region).toContain('- [x] `@scope/b` → 2.0.0-next.1 · `next` <!-- rk-sel:@scope/b -->');
      expect(region).toContain('- [x] `@scope/c` → 3.0.0-beta.4 · `beta` <!-- rk-sel:@scope/c -->');
    });

    it('should render a stable-only PR with no section headings (back-compat)', () => {
      const updates: Update[] = [
        { packageName: '@scope/a', newVersion: '1.1.0', filePath: '', channel: 'stable' },
        { packageName: '@scope/b', newVersion: '2.0.0', filePath: '', channel: 'stable' },
      ];
      const region = renderSelectionRegion(updates, new Set());

      expect(region).not.toContain(STABLE);
      expect(region).not.toContain(PRERELEASE);
      expect(region).toContain('- [x] `@scope/a` → 1.1.0 <!-- rk-sel:@scope/a -->');
      expect(region).toContain('- [x] `@scope/b` → 2.0.0 <!-- rk-sel:@scope/b -->');
    });

    it('should render a prerelease-only PR with no section headings but keep per-row dist-tags', () => {
      const updates: Update[] = [
        { packageName: '@scope/a', newVersion: '1.1.0-next.0', filePath: '', channel: 'prerelease' },
        { packageName: '@scope/b', newVersion: '2.0.0-next.3', filePath: '', channel: 'prerelease' },
      ];
      const region = renderSelectionRegion(updates, new Set());

      expect(region).not.toContain(STABLE);
      expect(region).not.toContain(PRERELEASE);
      expect(region).toContain('- [x] `@scope/a` → 1.1.0-next.0 · `next` <!-- rk-sel:@scope/a -->');
      expect(region).toContain('- [x] `@scope/b` → 2.0.0-next.3 · `next` <!-- rk-sel:@scope/b -->');
    });

    it('should derive the channel from the version when the update carries none (old manifest)', () => {
      // No `channel` field (pre-#485 manifest): the section split falls back to deriveReleaseChannel.
      const updates: Update[] = [
        { packageName: '@scope/a', newVersion: '1.1.0', filePath: '' },
        { packageName: '@scope/b', newVersion: '2.0.0-next.1', filePath: '' },
      ];
      const region = renderSelectionRegion(updates, new Set());

      expect(region).toContain(STABLE);
      expect(region).toContain(PRERELEASE);
      expect(region).toContain('- [x] `@scope/b` → 2.0.0-next.1 · `next` <!-- rk-sel:@scope/b -->');
    });

    it('should round-trip a deselection through render → extract across channel sections', () => {
      const updates: Update[] = [
        { packageName: '@scope/a', newVersion: '1.1.0', filePath: '', channel: 'stable' },
        { packageName: '@scope/b', newVersion: '2.0.0-next.1', filePath: '', channel: 'prerelease' },
      ];
      const body = `## Release\n\n${renderSelectionRegion(updates, new Set(['@scope/b']))}\n\nfooter`;
      // The prerelease row's dist-tag suffix sits before the marker, so identity round-trips unchanged.
      expect(extractSelection(body)).toEqual({ deselected: ['@scope/b'] });
    });

    describe('hierarchical (release units)', () => {
      const groups = { ui: { sync: 'linked' as const, packages: ['@scope/ui-*'] } };
      const allNames = ['@scope/ui-core', '@scope/ui-theme', '@scope/cli'];
      const cfg = (over: Partial<PrimaryConfig> = {}): PrimaryConfig => ({
        primaryPackages: ['@scope/ui-core', '@scope/cli'],
        selection: 'streamlined',
        groups,
        allPackageNames: allNames,
        ...over,
      });

      it('should place a stable unit and a prerelease unit in their primary’s channel section', () => {
        const updates: Update[] = [
          { packageName: '@scope/cli', newVersion: '4.2.0', filePath: '', channel: 'stable' },
          {
            packageName: '@scope/ui-core',
            newVersion: '1.0.0-next.2',
            filePath: '',
            group: 'ui',
            channel: 'prerelease',
          },
          {
            packageName: '@scope/ui-theme',
            newVersion: '1.0.0-next.2',
            filePath: '',
            group: 'ui',
            channel: 'prerelease',
          },
        ];
        const region = renderSelectionRegion(updates, new Set(), cfg());

        expect(region).toContain(STABLE);
        expect(region).toContain(PRERELEASE);
        // The stable primary lands in the Stable section; the prerelease unit (primary + coupled
        // member) lands whole in the Prereleases section under its primary's channel.
        expect(region.indexOf(STABLE)).toBeLessThan(region.indexOf('rk-sel:@scope/cli'));
        expect(region.indexOf('rk-sel:@scope/cli')).toBeLessThan(region.indexOf(PRERELEASE));
        expect(region).toContain('- [x] **`@scope/ui-core`** → 1.0.0-next.2 · `next` <!-- rk-sel:@scope/ui-core -->');
        expect(region).toContain('  - `@scope/ui-theme` → 1.0.0-next.2 · `next` · coupled');
        expect(region.indexOf(PRERELEASE)).toBeLessThan(region.indexOf('rk-sel:@scope/ui-core'));
      });

      it('should drop headings when every unit shares one channel', () => {
        const updates: Update[] = [
          { packageName: '@scope/cli', newVersion: '4.2.0', filePath: '', channel: 'stable' },
          { packageName: '@scope/ui-core', newVersion: '1.1.0', filePath: '', group: 'ui', channel: 'stable' },
          { packageName: '@scope/ui-theme', newVersion: '1.1.0', filePath: '', group: 'ui', channel: 'stable' },
        ];
        const region = renderSelectionRegion(updates, new Set(), cfg());
        expect(region).not.toContain(STABLE);
        expect(region).not.toContain(PRERELEASE);
      });
    });
  });

  describe('channel toggles', () => {
    const channel = (over: Partial<ChannelToggleConfig> = {}): ChannelToggleConfig => ({
      prereleased: new Set(),
      graduated: new Set(),
      ...over,
    });

    describe('renderSelectionRegion', () => {
      it('should render no channel toggle without a channel config', () => {
        const updates: Update[] = [{ packageName: '@scope/a', newVersion: '1.1.0', filePath: '' }];
        const region = renderSelectionRegion(updates, new Set());
        expect(region).not.toContain('rk-pre:');
        expect(region).not.toContain('rk-grad:');
      });

      it('should render an interactive "ship as prerelease" toggle under a stable row', () => {
        const updates: Update[] = [{ packageName: '@scope/a', newVersion: '10.2.0', filePath: '', channel: 'stable' }];
        const region = renderSelectionRegion(updates, new Set(), undefined, undefined, channel());
        expect(region).toContain('- [x] `@scope/a` → 10.2.0 <!-- rk-sel:@scope/a -->');
        expect(region).toContain('  - [ ] ship as prerelease → `10.2.0-next.0` · `next` <!-- rk-pre:@scope/a -->');
      });

      it('should render an interactive "graduate to stable" toggle under a prerelease row', () => {
        const updates: Update[] = [
          { packageName: '@scope/a', newVersion: '1.0.0-next.4', filePath: '', channel: 'prerelease' },
        ];
        const region = renderSelectionRegion(updates, new Set(), undefined, undefined, channel());
        expect(region).toContain('  - [ ] graduate to stable → `1.0.0` <!-- rk-grad:@scope/a -->');
      });

      it('should reflect the ticked state of a prereleased package', () => {
        const updates: Update[] = [{ packageName: '@scope/a', newVersion: '10.2.0', filePath: '', channel: 'stable' }];
        const region = renderSelectionRegion(
          updates,
          new Set(),
          undefined,
          undefined,
          channel({ prereleased: new Set(['@scope/a']) }),
        );
        expect(region).toContain('  - [x] ship as prerelease → `10.2.0-next.0` · `next` <!-- rk-pre:@scope/a -->');
      });

      it('should use the configured prerelease identifier in the toggle', () => {
        const updates: Update[] = [{ packageName: '@scope/a', newVersion: '10.2.0', filePath: '', channel: 'stable' }];
        const region = renderSelectionRegion(
          updates,
          new Set(),
          undefined,
          undefined,
          channel({ prereleaseIdentifier: 'beta' }),
        );
        expect(region).toContain('  - [ ] ship as prerelease → `10.2.0-beta.0` · `beta` <!-- rk-pre:@scope/a -->');
      });

      it('should render no channel toggle under a held-back (deselected) row', () => {
        const updates: Update[] = [{ packageName: '@scope/a', newVersion: '10.2.0', filePath: '', channel: 'stable' }];
        const region = renderSelectionRegion(updates, new Set(['@scope/a']), undefined, undefined, channel());
        expect(region).toContain('- [ ] `@scope/a` → 10.2.0 <!-- rk-sel:@scope/a -->');
        expect(region).not.toContain('rk-pre:@scope/a');
      });

      it('should attach the toggle to a streamlined primary row, not its read-only members', () => {
        const updates: Update[] = [
          { packageName: '@scope/app', newVersion: '2.0.0', filePath: '', group: 'g', channel: 'stable' },
          { packageName: '@scope/lib', newVersion: '2.0.0', filePath: '', group: 'g', channel: 'stable' },
        ];
        const primary: PrimaryConfig = {
          primaryPackages: ['@scope/app'],
          selection: 'streamlined',
          groups: { g: { sync: 'fixed', packages: ['@scope/*'] } },
          allPackageNames: ['@scope/app', '@scope/lib'],
        };
        const region = renderSelectionRegion(updates, new Set(), primary, undefined, channel());
        expect(region).toContain('- [ ] ship as prerelease → `2.0.0-next.0` · `next` <!-- rk-pre:@scope/app -->');
        // The streamlined member is a read-only bullet — it gets no channel toggle of its own.
        expect(region).not.toContain('rk-pre:@scope/lib');
      });
    });

    describe('extractChannelSelection', () => {
      it('should read ticked rk-pre and rk-grad markers back from a rendered body', () => {
        const updates: Update[] = [
          { packageName: '@scope/a', newVersion: '10.2.0', filePath: '', channel: 'stable' },
          { packageName: '@scope/b', newVersion: '1.0.0-next.4', filePath: '', channel: 'prerelease' },
        ];
        const region = renderSelectionRegion(
          updates,
          new Set(),
          undefined,
          undefined,
          channel({ prereleased: new Set(['@scope/a']), graduated: new Set(['@scope/b']) }),
        );
        expect(extractChannelSelection(region)).toEqual({ prereleased: ['@scope/a'], graduated: ['@scope/b'] });
      });

      it('should return empty sets when the body carries no selection region', () => {
        expect(extractChannelSelection('nothing to see here')).toEqual({ prereleased: [], graduated: [] });
      });

      it('should ignore an unticked channel toggle', () => {
        const updates: Update[] = [{ packageName: '@scope/a', newVersion: '10.2.0', filePath: '', channel: 'stable' }];
        const region = renderSelectionRegion(updates, new Set(), undefined, undefined, channel());
        expect(extractChannelSelection(region)).toEqual({ prereleased: [], graduated: [] });
      });

      it('should drop a ticked channel toggle whose row is held back — held back wins', () => {
        // Hand-crafted adversarial body: rk-sel unticked (held back) but rk-pre ticked. The hold-back
        // wins, so the channel toggle is moot.
        const region = [
          '<!-- releasekit-selection -->',
          '- [ ] `@scope/a` → 10.2.0 <!-- rk-sel:@scope/a -->',
          '  - [x] ship as prerelease → `10.2.0-next.0` · `next` <!-- rk-pre:@scope/a -->',
          '<!-- releasekit-selection-end -->',
        ].join('\n');
        expect(extractChannelSelection(region)).toEqual({ prereleased: [], graduated: [] });
      });
    });

    describe('resolveChannelConflicts', () => {
      it('should leave graduate untouched when no package is also prereleased', () => {
        expect(resolveChannelConflicts(['@scope/b'], ['@scope/a'])).toEqual({
          graduate: ['@scope/b'],
          conflicts: [],
        });
      });

      it('should drop a package from graduate when it is also prereleased — the rk-pre toggle wins', () => {
        // Otherwise the engine's authoritative stableOnly silently overrides the accepted prerelease
        // toggle: the PR shows the toggle ticked but the write publishes stable (#521).
        expect(resolveChannelConflicts(['@scope/a', '@scope/b'], ['@scope/a'])).toEqual({
          graduate: ['@scope/b'],
          conflicts: ['@scope/a'],
        });
      });

      it('should treat a graduate glob target that covers a prereleased package as a conflict', () => {
        // A broad graduate label like `graduate:@scope/*` must not slip past the exact prerelease name
        // — an exact-string check would miss it and pass both scopes to the engine (#521).
        expect(resolveChannelConflicts(['@scope/*'], ['@scope/a'])).toEqual({
          graduate: [],
          conflicts: ['@scope/*'],
        });
      });
    });
  });
});
