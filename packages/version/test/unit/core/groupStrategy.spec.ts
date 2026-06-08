import fs from 'node:fs';
import path from 'node:path';
import type { Package, Tool } from '@manypkg/get-packages';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as commitParser from '../../../src/changelog/commitParser.js';
import { createGroupStrategy } from '../../../src/core/groupStrategy.js';
import * as calculator from '../../../src/core/versionCalculator.js';
import type { PackagesWithRoot } from '../../../src/core/versionEngine.js';
import * as commandExecutor from '../../../src/git/commandExecutor.js';
import * as gitTags from '../../../src/git/tagsAndBranches.js';
import * as packageManagement from '../../../src/package/packageManagement.js';
import type { Config } from '../../../src/types.js';
import * as formatting from '../../../src/utils/formatting.js';
import * as jsonOutput from '../../../src/utils/jsonOutput.js';
import * as logging from '../../../src/utils/logging.js';

vi.mock('../../../src/git/tagsAndBranches.js');
vi.mock('../../../src/git/commandExecutor.js');
vi.mock('../../../src/utils/logging.js');
vi.mock('../../../src/core/versionCalculator.js');
vi.mock('../../../src/package/packageManagement.js');
vi.mock('../../../src/utils/jsonOutput.js');
vi.mock('../../../src/changelog/commitParser.js');
vi.mock('node:fs');
vi.mock('node:path');

function mkPackage(name: string, version: string): Package {
  const slug = name.replace(/^@/, '').replace(/[/]/g, '-');
  return {
    dir: `/ws/packages/${slug}`,
    relativeDir: `packages/${slug}`,
    packageJson: { name, version },
  } as unknown as Package;
}

function workspace(packages: Package[]): PackagesWithRoot {
  return {
    root: '/ws',
    rootDir: '/ws',
    tool: 'pnpm' as unknown as Tool,
    packages,
  } as unknown as PackagesWithRoot;
}

const baseConfig = (overrides: Partial<Config>): Config =>
  ({
    sync: false,
    preset: 'conventional',
    packages: [],
    tagTemplate: '${prefix}${version}',
    updateInternalDependencies: 'minor',
    versionPrefix: '',
    baseBranch: 'main',
    ...overrides,
  }) as Config;

describe('createGroupStrategy', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Only package.json exists — no Cargo.toml — so each release writes exactly one manifest.
    vi.mocked(fs.existsSync, { partial: true }).mockImplementation((p) => !String(p).endsWith('Cargo.toml'));
    vi.mocked(fs.readFileSync, { partial: true }).mockReturnValue('{}');
    vi.mocked(path.join, { partial: true }).mockImplementation((...args) => args.join('/'));
    vi.mocked(gitTags.getLatestTag).mockResolvedValue('');
    vi.mocked(gitTags.getLatestTagForPackage).mockResolvedValue('');
    vi.mocked(commandExecutor.execSync, { partial: true }).mockReturnValue(Buffer.from(''));
    vi.mocked(commitParser.extractChangelogEntriesFromCommits, { partial: true }).mockReturnValue([
      { type: 'added', description: 'New feature' },
    ]);
    // formatting helpers are not module-mocked — spy on the real (pure) implementations.
    vi.spyOn(formatting, 'formatVersionPrefix').mockReturnValue('v');
    vi.spyOn(formatting, 'formatTag').mockImplementation((version, prefix, name) =>
      name ? `${name}@${prefix}${version}` : `${prefix}${version}`,
    );
    vi.spyOn(formatting, 'deriveBaselineTagPrefix').mockReturnValue(undefined);
    vi.spyOn(formatting, 'displayTag').mockImplementation((tag) => tag);
    vi.spyOn(formatting, 'formatCommitMessage').mockImplementation((template, version, name) =>
      template.replace(/\$\{version\}/g, version).replace(/\$\{packageName\}/g, name || ''),
    );
  });

  afterEach(() => vi.restoreAllMocks());

  describe('fixed groups', () => {
    it('should release ALL members at the group version when only one member changed', async () => {
      const core = mkPackage('@wdio/native-core', '2.3.0');
      const utils = mkPackage('@wdio/native-utils', '2.3.0');
      const spy = mkPackage('@wdio/native-spy', '2.3.0');

      // Only native-utils has a releasable change (patch).
      vi.mocked(calculator.calculateVersion).mockImplementation(async (_cfg, opts) => {
        if (opts.name === '@wdio/native-utils') return '2.3.1';
        return '';
      });

      const strategy = createGroupStrategy(
        baseConfig({ groups: { native: { packages: ['@wdio/native-*'], sync: 'fixed' } } }),
      );
      await strategy(workspace([core, utils, spy]));

      // Group version = bump(max baseline 2.3.0) with patch = 2.3.1. All three members written.
      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(
        '/ws/packages/wdio-native-core/package.json',
        '2.3.1',
        undefined,
      );
      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(
        '/ws/packages/wdio-native-utils/package.json',
        '2.3.1',
        undefined,
      );
      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(
        '/ws/packages/wdio-native-spy/package.json',
        '2.3.1',
        undefined,
      );
      // Each member tagged with the group name for CI surfaces.
      expect(jsonOutput.setPackageUpdateGroup).toHaveBeenCalledWith('@wdio/native-core', 'native');
      expect(jsonOutput.setPackageUpdateGroup).toHaveBeenCalledWith('@wdio/native-spy', 'native');
    });

    it('should warn about divergence when a releasing fixed group excludes a member', async () => {
      const core = mkPackage('@wdio/native-core', '2.3.0');
      const utils = mkPackage('@wdio/native-utils', '2.3.0');
      const spy = mkPackage('@wdio/native-spy', '2.3.0');

      // core changes; spy is excluded via config.skip, so the group releases without it.
      vi.mocked(calculator.calculateVersion).mockImplementation(async (_cfg, opts) =>
        opts.name === '@wdio/native-core' ? '2.3.1' : '',
      );

      const strategy = createGroupStrategy(
        baseConfig({ skip: ['@wdio/native-spy'], groups: { native: { packages: ['@wdio/native-*'], sync: 'fixed' } } }),
      );
      await strategy(workspace([core, utils, spy]));

      expect(logging.log).toHaveBeenCalledWith(
        expect.stringContaining('will release without: @wdio/native-spy'),
        'warning',
      );
    });

    it('should NOT warn about divergence when the fixed group has no releasable changes', async () => {
      const core = mkPackage('@wdio/native-core', '2.3.0');
      const utils = mkPackage('@wdio/native-utils', '2.3.0');
      const spy = mkPackage('@wdio/native-spy', '2.3.0');

      // Nothing changes. spy is excluded via config.skip, but since the group does not release,
      // the divergence warning must not fire (it would only confuse — nothing is being released).
      vi.mocked(calculator.calculateVersion).mockResolvedValue('');

      const strategy = createGroupStrategy(
        baseConfig({ skip: ['@wdio/native-spy'], groups: { native: { packages: ['@wdio/native-*'], sync: 'fixed' } } }),
      );
      await strategy(workspace([core, utils, spy]));

      expect(logging.log).not.toHaveBeenCalledWith(expect.stringContaining('will release without'), 'warning');
    });

    it('should take the largest bump across members for the shared group version', async () => {
      const core = mkPackage('@wdio/native-core', '2.3.0');
      const utils = mkPackage('@wdio/native-utils', '2.3.0');

      // core gets a minor, utils gets a patch — group should bump minor.
      vi.mocked(calculator.calculateVersion).mockImplementation(async (_cfg, opts) => {
        if (opts.name === '@wdio/native-core') return '2.4.0';
        if (opts.name === '@wdio/native-utils') return '2.3.1';
        return '';
      });

      const strategy = createGroupStrategy(
        baseConfig({ groups: { native: { packages: ['@wdio/native-*'], sync: 'fixed' } } }),
      );
      await strategy(workspace([core, utils]));

      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(
        '/ws/packages/wdio-native-core/package.json',
        '2.4.0',
        undefined,
      );
      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(
        '/ws/packages/wdio-native-utils/package.json',
        '2.4.0',
        undefined,
      );
    });

    it('should not release any member when no member has a releasable change', async () => {
      const core = mkPackage('@wdio/native-core', '2.3.0');
      const utils = mkPackage('@wdio/native-utils', '2.3.0');
      vi.mocked(calculator.calculateVersion).mockResolvedValue('');

      const strategy = createGroupStrategy(
        baseConfig({ groups: { native: { packages: ['@wdio/native-*'], sync: 'fixed' } } }),
      );
      await strategy(workspace([core, utils]));

      expect(packageManagement.updatePackageVersion).not.toHaveBeenCalled();
      expect(jsonOutput.setCommitMessage).not.toHaveBeenCalled();
    });
  });

  describe('linked groups', () => {
    it('should release ONLY changed members, all at the shared computed version', async () => {
      const core = mkPackage('@wdio/native-core', '2.3.0');
      const utils = mkPackage('@wdio/native-utils', '2.3.0');
      const spy = mkPackage('@wdio/native-spy', '2.3.0');

      // Only utils changed.
      vi.mocked(calculator.calculateVersion).mockImplementation(async (_cfg, opts) => {
        if (opts.name === '@wdio/native-utils') return '2.3.1';
        return '';
      });

      const strategy = createGroupStrategy(
        baseConfig({ groups: { native: { packages: ['@wdio/native-*'], sync: 'linked' } } }),
      );
      await strategy(workspace([core, utils, spy]));

      // Only the changed member is written — the dealbreaker case from the issue (no empty
      // re-release of unchanged members).
      expect(packageManagement.updatePackageVersion).toHaveBeenCalledTimes(1);
      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(
        '/ws/packages/wdio-native-utils/package.json',
        '2.3.1',
        undefined,
      );
      expect(packageManagement.updatePackageVersion).not.toHaveBeenCalledWith(
        '/ws/packages/wdio-native-core/package.json',
        expect.anything(),
        expect.anything(),
      );
    });

    it('should align multiple changed members to the same shared version', async () => {
      const core = mkPackage('@wdio/native-core', '2.3.0');
      const utils = mkPackage('@wdio/native-utils', '2.3.0');
      const spy = mkPackage('@wdio/native-spy', '2.3.0');

      // core minor, utils patch, spy unchanged → both changed members align to 2.4.0.
      vi.mocked(calculator.calculateVersion).mockImplementation(async (_cfg, opts) => {
        if (opts.name === '@wdio/native-core') return '2.4.0';
        if (opts.name === '@wdio/native-utils') return '2.3.1';
        return '';
      });

      const strategy = createGroupStrategy(
        baseConfig({ groups: { native: { packages: ['@wdio/native-*'], sync: 'linked' } } }),
      );
      await strategy(workspace([core, utils, spy]));

      expect(packageManagement.updatePackageVersion).toHaveBeenCalledTimes(2);
      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(
        '/ws/packages/wdio-native-core/package.json',
        '2.4.0',
        undefined,
      );
      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(
        '/ws/packages/wdio-native-utils/package.json',
        '2.4.0',
        undefined,
      );
    });
  });

  describe('group baseline = max(member baselines)', () => {
    it('should bump from the highest member baseline, not each member individually', async () => {
      const core = mkPackage('@wdio/native-core', '2.3.0');
      // utils sits at a higher baseline than core.
      const utils = mkPackage('@wdio/native-utils', '2.5.0');

      vi.mocked(calculator.calculateVersion).mockImplementation(async (_cfg, opts) => {
        // core earns a patch from its own 2.3.0 baseline.
        if (opts.name === '@wdio/native-core') return '2.3.1';
        return '';
      });

      const strategy = createGroupStrategy(
        baseConfig({ groups: { native: { packages: ['@wdio/native-*'], sync: 'fixed' } } }),
      );
      await strategy(workspace([core, utils]));

      // max baseline is 2.5.0, patch bump → 2.5.1 for the whole group (NOT core's 2.3.1).
      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(
        '/ws/packages/wdio-native-core/package.json',
        '2.5.1',
        undefined,
      );
      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(
        '/ws/packages/wdio-native-utils/package.json',
        '2.5.1',
        undefined,
      );
    });
  });

  describe('below-baseline member adoption', () => {
    it('should make a below-baseline member adopt the group version and warn on a >1-bump jump', async () => {
      // core is the family at 2.3.0; newcomer joins at 1.0.0.
      const core = mkPackage('@wdio/native-core', '2.3.0');
      const newcomer = mkPackage('@wdio/native-fresh', '1.0.0');

      vi.mocked(calculator.calculateVersion).mockImplementation(async (_cfg, opts) => {
        if (opts.name === '@wdio/native-core') return '2.3.1';
        // newcomer also has a change, but its own bump is irrelevant under fixed.
        if (opts.name === '@wdio/native-fresh') return '1.0.1';
        return '';
      });

      const strategy = createGroupStrategy(
        baseConfig({ groups: { native: { packages: ['@wdio/native-*'], sync: 'fixed' } } }),
      );
      await strategy(workspace([core, newcomer]));

      // newcomer adopts the group version 2.3.1, skipping its own 1.x line.
      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(
        '/ws/packages/wdio-native-fresh/package.json',
        '2.3.1',
        undefined,
      );
      // A loud warning should fire for the big jump.
      expect(logging.log).toHaveBeenCalledWith(expect.stringContaining('adopts group version 2.3.1'), 'warning');
    });
  });

  describe('--target on a fixed group', () => {
    it('should expand a targeted subset of a fixed group to all members', async () => {
      const core = mkPackage('@wdio/native-core', '2.3.0');
      const utils = mkPackage('@wdio/native-utils', '2.3.0');

      vi.mocked(calculator.calculateVersion).mockImplementation(async (_cfg, opts) => {
        if (opts.name === '@wdio/native-core') return '2.3.1';
        if (opts.name === '@wdio/native-utils') return '2.3.1';
        return '';
      });

      const strategy = createGroupStrategy(
        baseConfig({ groups: { native: { packages: ['@wdio/native-*'], sync: 'fixed' } } }),
      );
      // Target only core — fixed group should expand to include utils.
      await strategy(workspace([core, utils]), ['@wdio/native-core']);

      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(
        '/ws/packages/wdio-native-core/package.json',
        '2.3.1',
        undefined,
      );
      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(
        '/ws/packages/wdio-native-utils/package.json',
        '2.3.1',
        undefined,
      );
    });
  });

  describe('sync:true equivalence (implicit fixed group)', () => {
    it('should release every package in lockstep at the shared version under sync:true', async () => {
      const a = mkPackage('@app/a', '1.0.0');
      const b = mkPackage('@app/b', '1.0.0');

      vi.mocked(calculator.calculateVersion).mockImplementation(async (_cfg, opts) => {
        if (opts.name === '@app/a') return '1.1.0';
        return '';
      });

      const strategy = createGroupStrategy(baseConfig({ sync: true }));
      await strategy(workspace([a, b]));

      // Both packages bump to 1.1.0 even though only a changed (fixed semantics).
      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(
        '/ws/packages/app-a/package.json',
        '1.1.0',
        undefined,
      );
      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(
        '/ws/packages/app-b/package.json',
        '1.1.0',
        undefined,
      );
    });
  });

  describe('ungrouped packages', () => {
    it('should version ungrouped packages independently at their own computed version', async () => {
      const core = mkPackage('@wdio/native-core', '2.3.0');
      const standalone = mkPackage('@app/standalone', '5.0.0');

      vi.mocked(calculator.calculateVersion).mockImplementation(async (_cfg, opts) => {
        if (opts.name === '@wdio/native-core') return '2.3.1';
        if (opts.name === '@app/standalone') return '5.1.0';
        return '';
      });

      const strategy = createGroupStrategy(
        baseConfig({ groups: { native: { packages: ['@wdio/native-*'], sync: 'fixed' } } }),
      );
      await strategy(workspace([core, standalone]));

      // standalone keeps its own independent bump.
      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(
        '/ws/packages/app-standalone/package.json',
        '5.1.0',
        undefined,
      );
      // and is NOT tagged with the group.
      expect(jsonOutput.setPackageUpdateGroup).not.toHaveBeenCalledWith('@app/standalone', expect.anything());
    });
  });

  describe('config errors', () => {
    it('should throw when a package matches two groups', async () => {
      const core = mkPackage('@wdio/native-core', '2.3.0');
      const strategy = createGroupStrategy(
        baseConfig({
          groups: {
            a: { packages: ['@wdio/native-*'], sync: 'fixed' },
            b: { packages: ['@wdio/native-core'], sync: 'linked' },
          },
        }),
      );
      await expect(strategy(workspace([core]))).rejects.toThrow(/more than one version group/);
    });
  });
});
