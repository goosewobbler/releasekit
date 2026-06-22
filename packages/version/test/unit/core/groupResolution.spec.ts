import type { Package } from '@manypkg/get-packages';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  expandTargetsForAtomicGroups,
  hasExplicitGroups,
  hasGroups,
  IMPLICIT_SYNC_GROUP,
  normalizeGroupDefinitions,
  resolveGroups,
} from '../../../src/core/groupResolution.js';
import type { Config } from '../../../src/types.js';

vi.mock('../../../src/utils/logging.js');

function pkg(name: string, version = '1.0.0'): Package {
  return {
    dir: `/ws/packages/${name.replace(/[@/]/g, '-')}`,
    relativeDir: `packages/${name}`,
    packageJson: { name, version },
  } as unknown as Package;
}

const base = (overrides: Partial<Config>): Config =>
  ({
    sync: false,
    preset: 'conventional',
    packages: [],
    tagTemplate: '${prefix}${version}',
    updateInternalDependencies: 'minor',
    versionPrefix: '',
    ...overrides,
  }) as Config;

describe('groupResolution', () => {
  afterEach(() => vi.restoreAllMocks());

  describe('normalizeGroupDefinitions (sync:true → implicit fixed group)', () => {
    it('should desugar sync:true into one implicit fixed group of every package', () => {
      const defs = normalizeGroupDefinitions(base({ sync: true }));
      expect(defs).toEqual([{ name: IMPLICIT_SYNC_GROUP, packages: ['**'], sync: 'fixed' }]);
    });

    it('should carry explicit groups through unchanged when sync is false', () => {
      const defs = normalizeGroupDefinitions(
        base({
          sync: false,
          groups: {
            native: { packages: ['@wdio/native-*'], sync: 'linked' },
          },
        }),
      );
      expect(defs).toEqual([{ name: 'native', packages: ['@wdio/native-*'], sync: 'linked' }]);
    });

    it('should let the implicit sync group win and warn when sync:true and groups both set', () => {
      const defs = normalizeGroupDefinitions(
        base({
          sync: true,
          groups: { native: { packages: ['@wdio/native-*'], sync: 'linked' } },
        }),
      );
      expect(defs).toEqual([{ name: IMPLICIT_SYNC_GROUP, packages: ['**'], sync: 'fixed' }]);
    });

    it('should return no definitions when neither sync nor groups are set', () => {
      expect(normalizeGroupDefinitions(base({ sync: false }))).toEqual([]);
    });
  });

  describe('resolveGroups', () => {
    const packages = [
      pkg('@wdio/native-core'),
      pkg('@wdio/native-utils'),
      pkg('@app/service-a'),
      pkg('@app/service-b'),
    ];

    it('should assign matched packages to their group and leave the rest ungrouped', () => {
      const res = resolveGroups(
        base({ groups: { native: { packages: ['@wdio/native-*'], sync: 'fixed' } } }),
        packages,
      );

      expect(res.groups).toHaveLength(1);
      expect(res.groups[0].members.map((m) => m.packageJson.name)).toEqual(['@wdio/native-core', '@wdio/native-utils']);
      expect(res.ungrouped.map((m) => m.packageJson.name)).toEqual(['@app/service-a', '@app/service-b']);
    });

    it('should resolve a package to its owning group via groupOf', () => {
      const res = resolveGroups(
        base({ groups: { native: { packages: ['@wdio/native-*'], sync: 'fixed' } } }),
        packages,
      );
      expect(res.groupOf('@wdio/native-core')?.name).toBe('native');
      expect(res.groupOf('@app/service-a')).toBeUndefined();
    });

    it('should put every package in the implicit group for sync:true', () => {
      const res = resolveGroups(base({ sync: true }), packages);
      expect(res.groups).toHaveLength(1);
      expect(res.groups[0].name).toBe(IMPLICIT_SYNC_GROUP);
      expect(res.groups[0].sync).toBe('fixed');
      expect(res.groups[0].implicit).toBe(true);
      expect(res.groups[0].members).toHaveLength(4);
      expect(res.ungrouped).toHaveLength(0);
    });

    it('should throw when a package matches more than one group', () => {
      expect(() =>
        resolveGroups(
          base({
            groups: {
              a: { packages: ['@wdio/native-*'], sync: 'fixed' },
              b: { packages: ['@wdio/native-core'], sync: 'linked' },
            },
          }),
          packages,
        ),
      ).toThrow(/more than one version group/);
    });

    it('should drop groups that matched no packages with a warning rather than aborting', () => {
      const res = resolveGroups(base({ groups: { ghost: { packages: ['@nope/*'], sync: 'fixed' } } }), packages);
      expect(res.groups).toHaveLength(0);
      expect(res.ungrouped).toHaveLength(4);
    });
  });

  describe('hasExplicitGroups / hasGroups', () => {
    it('should report explicit groups only for hasExplicitGroups', () => {
      expect(hasExplicitGroups(base({ sync: true }))).toBe(false);
      expect(hasExplicitGroups(base({ groups: { g: { packages: ['a'], sync: 'fixed' } } }))).toBe(true);
    });

    it('should report sync:true as a group mechanism for hasGroups', () => {
      expect(hasGroups(base({ sync: true }))).toBe(true);
      expect(hasGroups(base({ sync: false }))).toBe(false);
      expect(hasGroups(base({ sync: false, groups: { g: { packages: ['a'], sync: 'linked' } } }))).toBe(true);
    });
  });

  describe('expandTargetsForAtomicGroups (--target on a subset of a fixed group)', () => {
    const packages = [pkg('@wdio/native-core'), pkg('@wdio/native-utils'), pkg('@wdio/native-spy')];

    it('should expand a strict subset of a fixed group to the whole group', () => {
      const res = resolveGroups(
        base({ groups: { native: { packages: ['@wdio/native-*'], sync: 'fixed' } } }),
        packages,
      );
      const { targets, expandedGroups } = expandTargetsForAtomicGroups(res, ['@wdio/native-core']);
      expect(new Set(targets)).toEqual(new Set(['@wdio/native-core', '@wdio/native-utils', '@wdio/native-spy']));
      expect(expandedGroups).toEqual(['native']);
    });

    it('should not expand when all members of a fixed group are already targeted', () => {
      const res = resolveGroups(
        base({ groups: { native: { packages: ['@wdio/native-*'], sync: 'fixed' } } }),
        packages,
      );
      const { expandedGroups } = expandTargetsForAtomicGroups(res, ['@wdio/native-*']);
      expect(expandedGroups).toEqual([]);
    });

    it('should expand a strict subset of an independent group to the whole group', () => {
      const res = resolveGroups(
        base({ groups: { native: { packages: ['@wdio/native-*'], sync: 'independent' } } }),
        packages,
      );
      const { targets, expandedGroups } = expandTargetsForAtomicGroups(res, ['@wdio/native-core']);
      expect(new Set(targets)).toEqual(new Set(['@wdio/native-core', '@wdio/native-utils', '@wdio/native-spy']));
      expect(expandedGroups).toEqual(['native']);
    });

    it('should NOT expand a linked group (partial targeting is well defined there)', () => {
      const res = resolveGroups(
        base({ groups: { native: { packages: ['@wdio/native-*'], sync: 'linked' } } }),
        packages,
      );
      const { targets, expandedGroups } = expandTargetsForAtomicGroups(res, ['@wdio/native-core']);
      expect(targets).toEqual(['@wdio/native-core']);
      expect(expandedGroups).toEqual([]);
    });

    it('should be a no-op when no targets are provided', () => {
      const res = resolveGroups(
        base({ groups: { native: { packages: ['@wdio/native-*'], sync: 'fixed' } } }),
        packages,
      );
      expect(expandTargetsForAtomicGroups(res, [])).toEqual({ targets: [], expandedGroups: [] });
    });
  });
});
