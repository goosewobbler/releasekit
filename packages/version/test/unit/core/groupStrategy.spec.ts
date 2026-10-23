import fs from 'node:fs';
import path from 'node:path';
import type { Package, Tool } from '@manypkg/get-packages';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as commitParser from '../../../src/changelog/commitParser.js';
import { createGroupStrategy } from '../../../src/core/groupStrategy.js';
import * as calculator from '../../../src/core/versionCalculator.js';
import type { PackagesWithRoot } from '../../../src/core/versionEngine.js';
import * as gitTags from '../../../src/git/tagsAndBranches.js';
import * as tagVerification from '../../../src/git/tagVerification.js';
import * as packageManagement from '../../../src/package/packageManagement.js';
import type { Config } from '../../../src/types.js';
import * as formatting from '../../../src/utils/formatting.js';
import * as jsonOutput from '../../../src/utils/jsonOutput.js';
import * as logging from '../../../src/utils/logging.js';

vi.mock('../../../src/git/tagsAndBranches.js');
vi.mock('../../../src/git/tagVerification.js');
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
    preset: 'conventionalcommits',
    packages: [],
    tagTemplate: '${prefix}${version}',
    versionPrefix: '',
    ...overrides,
  }) as Config;

describe('createGroupStrategy', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // No Cargo.toml, so each release writes exactly one manifest.
    vi.mocked(fs.existsSync, { partial: true }).mockImplementation((p) => !String(p).endsWith('Cargo.toml'));
    vi.mocked(fs.readFileSync, { partial: true }).mockReturnValue('{}');
    vi.mocked(path.join, { partial: true }).mockImplementation((...args) => args.join('/'));
    vi.mocked(gitTags.getLatestTag).mockResolvedValue('');
    vi.mocked(gitTags.getLatestTagForPackage).mockResolvedValue('');
    vi.mocked(tagVerification.verifyTag, { partial: true }).mockResolvedValue({ exists: true, reachable: true });
    vi.mocked(commitParser.extractChangelogEntriesFromCommits, { partial: true }).mockResolvedValue([
      { type: 'added', description: 'New feature' },
    ]);
    // formatting isn't module-mocked, so these spy on the real module.
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

      vi.mocked(calculator.calculateVersion).mockImplementation(async (_cfg, opts) => {
        if (opts.name === '@wdio/native-utils') {
          return '2.3.1';
        }
        return '';
      });

      const strategy = createGroupStrategy(
        baseConfig({ groups: { native: { packages: ['@wdio/native-*'], sync: 'fixed' } } }),
      );
      await strategy(workspace([core, utils, spy]));

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
      expect(jsonOutput.setPackageUpdateGroup).toHaveBeenCalledWith('@wdio/native-core', 'native');
      expect(jsonOutput.setPackageUpdateGroup).toHaveBeenCalledWith('@wdio/native-spy', 'native');
    });

    it('should warn about divergence when a releasing fixed group excludes a member', async () => {
      const core = mkPackage('@wdio/native-core', '2.3.0');
      const utils = mkPackage('@wdio/native-utils', '2.3.0');
      const spy = mkPackage('@wdio/native-spy', '2.3.0');

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

      vi.mocked(calculator.calculateVersion).mockImplementation(async (_cfg, opts) => {
        if (opts.name === '@wdio/native-core') {
          return '2.4.0';
        }
        if (opts.name === '@wdio/native-utils') {
          return '2.3.1';
        }
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

      vi.mocked(calculator.calculateVersion).mockImplementation(async (_cfg, opts) => {
        if (opts.name === '@wdio/native-utils') {
          return '2.3.1';
        }
        return '';
      });

      const strategy = createGroupStrategy(
        baseConfig({ groups: { native: { packages: ['@wdio/native-*'], sync: 'linked' } } }),
      );
      await strategy(workspace([core, utils, spy]));

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

      vi.mocked(calculator.calculateVersion).mockImplementation(async (_cfg, opts) => {
        if (opts.name === '@wdio/native-core') {
          return '2.4.0';
        }
        if (opts.name === '@wdio/native-utils') {
          return '2.3.1';
        }
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

    it('should stay on the prerelease line when a member creates a prerelease from a stable baseline', async () => {
      // premajor 0.0.1 -> 1.0.0-next.0. The aggregate magnitude is a stable `major`, so without the pre-variant
      // the group graduates to 1.0.0, and never-regress can't recover it (1.0.0-next.0 < 1.0.0 in semver).
      const service = mkPackage('@wdio/flutter-service', '0.0.1');
      const contract = mkPackage('wdio_flutter', '0.0.1');

      vi.mocked(calculator.calculateVersion).mockImplementation(async (_cfg, opts) => {
        if (opts.name === '@wdio/flutter-service') {
          return '1.0.0-next.0';
        }
        return '';
      });

      const strategy = createGroupStrategy(
        baseConfig({
          prereleaseIdentifier: 'next',
          groups: { flutter: { packages: ['@wdio/flutter-service', 'wdio_flutter'], sync: 'linked' } },
        }),
      );
      await strategy(workspace([service, contract]));

      expect(packageManagement.updatePackageVersion).toHaveBeenCalledTimes(1);
      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(
        '/ws/packages/wdio-flutter-service/package.json',
        '1.0.0-next.0',
        undefined,
      );
    });

    it('should stay on the prerelease line for a fixed group creating a prerelease from a stable baseline', async () => {
      // sync only changes which members release, not the groupVersion computation, so fixed must hold too.
      const service = mkPackage('@wdio/flutter-service', '0.0.1');
      const contract = mkPackage('wdio_flutter', '0.0.1');

      vi.mocked(calculator.calculateVersion).mockImplementation(async (_cfg, opts) => {
        if (opts.name === '@wdio/flutter-service') {
          return '1.0.0-next.0';
        }
        return '';
      });

      const strategy = createGroupStrategy(
        baseConfig({
          prereleaseIdentifier: 'next',
          groups: { flutter: { packages: ['@wdio/flutter-service', 'wdio_flutter'], sync: 'fixed' } },
        }),
      );
      await strategy(workspace([service, contract]));

      expect(packageManagement.updatePackageVersion).toHaveBeenCalledTimes(2);
      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(
        '/ws/packages/wdio-flutter-service/package.json',
        '1.0.0-next.0',
        undefined,
      );
      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(
        '/ws/packages/wdio_flutter/package.json',
        '1.0.0-next.0',
        undefined,
      );
    });

    it('should increment within the prerelease when the latest tag is a prerelease', async () => {
      // The published prerelease lives in the tag while the manifest still reads 0.0.1 (an
      // interrupted release that tagged & published but never committed the bump). The baseline must
      // keep the tag's prerelease, else it coerces to a stable 1.0.0 and the group graduates to
      // 2.0.0-next.0 instead of incrementing to 1.0.0-next.1.
      const service = mkPackage('@wdio/flutter-service', '0.0.1');
      const contract = mkPackage('wdio_flutter', '0.0.1');

      vi.mocked(gitTags.getLatestTagForPackage).mockImplementation(async (name) =>
        name === '@wdio/flutter-service' ? 'wdio-flutter-service@v1.0.0-next.0' : '',
      );
      vi.mocked(calculator.calculateVersion).mockImplementation(async (_cfg, opts) =>
        opts.name === '@wdio/flutter-service' ? '1.0.0-next.1' : '',
      );

      const strategy = createGroupStrategy(
        baseConfig({
          prereleaseIdentifier: 'next',
          groups: { flutter: { packages: ['@wdio/flutter-service', 'wdio_flutter'], sync: 'linked' } },
        }),
      );
      await strategy(workspace([service, contract]));

      expect(packageManagement.updatePackageVersion).toHaveBeenCalledTimes(1);
      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(
        '/ws/packages/wdio-flutter-service/package.json',
        '1.0.0-next.1',
        undefined,
      );
    });

    it('should increment within the prerelease for a fixed group when the latest tag is a prerelease', async () => {
      // Same interrupted-release baseline as the linked case; `fixed` would write a wrong version to every member.
      const service = mkPackage('@wdio/flutter-service', '0.0.1');
      const contract = mkPackage('wdio_flutter', '0.0.1');

      vi.mocked(gitTags.getLatestTagForPackage).mockImplementation(async (name) =>
        name === '@wdio/flutter-service' ? 'wdio-flutter-service@v1.0.0-next.0' : '',
      );
      vi.mocked(calculator.calculateVersion).mockImplementation(async (_cfg, opts) =>
        opts.name === '@wdio/flutter-service' ? '1.0.0-next.1' : '',
      );

      const strategy = createGroupStrategy(
        baseConfig({
          prereleaseIdentifier: 'next',
          groups: { flutter: { packages: ['@wdio/flutter-service', 'wdio_flutter'], sync: 'fixed' } },
        }),
      );
      await strategy(workspace([service, contract]));

      expect(packageManagement.updatePackageVersion).toHaveBeenCalledTimes(2);
      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(
        '/ws/packages/wdio-flutter-service/package.json',
        '1.0.0-next.1',
        undefined,
      );
      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(
        '/ws/packages/wdio_flutter/package.json',
        '1.0.0-next.1',
        undefined,
      );
    });

    it('should not graduate an explicit prerelease when a member manifest lags its prerelease tag', async () => {
      // Manifest 0.0.1 lags the unreachable 1.0.0-next.0 tag, so ownNext (0.0.2-next.0) sits below the group
      // baseline. The backwards diff reads as a `major`, but graduation requires stable=true and never-regress
      // can't recover a stable 1.0.0.
      const service = mkPackage('@wdio/flutter-service', '0.0.1');
      const contract = mkPackage('wdio_flutter', '0.0.1');

      vi.mocked(gitTags.getLatestTagForPackage).mockImplementation(async (name) =>
        name === '@wdio/flutter-service' ? 'wdio-flutter-service@v1.0.0-next.0' : '',
      );
      vi.mocked(calculator.calculateVersion).mockImplementation(async (_cfg, opts) =>
        opts.name === '@wdio/flutter-service' ? '0.0.2-next.0' : '',
      );

      const strategy = createGroupStrategy(
        baseConfig({
          isPrerelease: true,
          prereleaseIdentifier: 'next',
          groups: { flutter: { packages: ['@wdio/flutter-service', 'wdio_flutter'], sync: 'linked' } },
        }),
      );
      await strategy(workspace([service, contract]));

      expect(packageManagement.updatePackageVersion).toHaveBeenCalledTimes(1);
      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(
        '/ws/packages/wdio-flutter-service/package.json',
        '1.0.0-next.1',
        undefined,
      );
    });

    it('should not graduate an explicit prerelease in a fixed group when a member manifest lags its tag', async () => {
      // As above, but `fixed` would stamp a silent graduation across the whole group.
      const service = mkPackage('@wdio/flutter-service', '0.0.1');
      const contract = mkPackage('wdio_flutter', '0.0.1');

      vi.mocked(gitTags.getLatestTagForPackage).mockImplementation(async (name) =>
        name === '@wdio/flutter-service' ? 'wdio-flutter-service@v1.0.0-next.0' : '',
      );
      vi.mocked(calculator.calculateVersion).mockImplementation(async (_cfg, opts) =>
        opts.name === '@wdio/flutter-service' ? '0.0.2-next.0' : '',
      );

      const strategy = createGroupStrategy(
        baseConfig({
          isPrerelease: true,
          prereleaseIdentifier: 'next',
          groups: { flutter: { packages: ['@wdio/flutter-service', 'wdio_flutter'], sync: 'fixed' } },
        }),
      );
      await strategy(workspace([service, contract]));

      expect(packageManagement.updatePackageVersion).toHaveBeenCalledTimes(2);
      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(
        '/ws/packages/wdio-flutter-service/package.json',
        '1.0.0-next.1',
        undefined,
      );
      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(
        '/ws/packages/wdio_flutter/package.json',
        '1.0.0-next.1',
        undefined,
      );
    });

    it('should still advance the prerelease when no prereleaseIdentifier is configured', async () => {
      // Same manifest-lags-tag scenario; the risk is re-emitting the published baseline, which never-regress
      // can't catch since ownNext sits below maxBaseline.
      const service = mkPackage('@wdio/flutter-service', '0.0.1');
      const contract = mkPackage('wdio_flutter', '0.0.1');

      vi.mocked(gitTags.getLatestTagForPackage).mockImplementation(async (name) =>
        name === '@wdio/flutter-service' ? 'wdio-flutter-service@v1.0.0-next.0' : '',
      );
      vi.mocked(calculator.calculateVersion).mockImplementation(async (_cfg, opts) =>
        opts.name === '@wdio/flutter-service' ? '0.0.2-next.0' : '',
      );

      const strategy = createGroupStrategy(
        baseConfig({
          isPrerelease: true,
          groups: { flutter: { packages: ['@wdio/flutter-service', 'wdio_flutter'], sync: 'linked' } },
        }),
      );
      await strategy(workspace([service, contract]));

      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(
        '/ws/packages/wdio-flutter-service/package.json',
        '1.0.0-next.1',
        undefined,
      );
    });

    it('should advance the prerelease when the aggregate rank is itself prerelease and no identifier is set', async () => {
      // A higher member's prerelease tag sets the group baseline (1.0.0-next.0) while the changed member only
      // increments its own lower line. Returning the baseline unchanged would republish 1.0.0-next.0, and
      // never-regress can't raise it.
      const service = mkPackage('@wdio/flutter-service', '1.0.0-next.0');
      const contract = mkPackage('wdio_flutter', '0.9.0-next.0');

      vi.mocked(gitTags.getLatestTagForPackage).mockImplementation(async (name) =>
        name === '@wdio/flutter-service' ? 'wdio-flutter-service@v1.0.0-next.0' : '',
      );
      vi.mocked(calculator.calculateVersion).mockImplementation(async (_cfg, opts) =>
        opts.name === 'wdio_flutter' ? '0.9.0-next.1' : '',
      );

      const strategy = createGroupStrategy(
        baseConfig({
          isPrerelease: true,
          groups: { flutter: { packages: ['@wdio/flutter-service', 'wdio_flutter'], sync: 'linked' } },
        }),
      );
      await strategy(workspace([service, contract]));

      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(
        '/ws/packages/wdio_flutter/package.json',
        '1.0.0-next.1',
        undefined,
      );
    });
  });

  describe('group baseline = max(member baselines)', () => {
    it('should bump from the highest member baseline, not each member individually', async () => {
      const core = mkPackage('@wdio/native-core', '2.3.0');
      const utils = mkPackage('@wdio/native-utils', '2.5.0');

      vi.mocked(calculator.calculateVersion).mockImplementation(async (_cfg, opts) => {
        if (opts.name === '@wdio/native-core') {
          return '2.3.1';
        }
        return '';
      });

      const strategy = createGroupStrategy(
        baseConfig({ groups: { native: { packages: ['@wdio/native-*'], sync: 'fixed' } } }),
      );
      await strategy(workspace([core, utils]));

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
      const core = mkPackage('@wdio/native-core', '2.3.0');
      const newcomer = mkPackage('@wdio/native-fresh', '1.0.0');

      vi.mocked(calculator.calculateVersion).mockImplementation(async (_cfg, opts) => {
        if (opts.name === '@wdio/native-core') {
          return '2.3.1';
        }
        // newcomer's own bump is irrelevant under fixed.
        if (opts.name === '@wdio/native-fresh') {
          return '1.0.1';
        }
        return '';
      });

      const strategy = createGroupStrategy(
        baseConfig({ groups: { native: { packages: ['@wdio/native-*'], sync: 'fixed' } } }),
      );
      await strategy(workspace([core, newcomer]));

      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(
        '/ws/packages/wdio-native-fresh/package.json',
        '2.3.1',
        undefined,
      );
      expect(logging.log).toHaveBeenCalledWith(expect.stringContaining('adopts group version 2.3.1'), 'warning');
    });
  });

  describe('--target on a fixed group', () => {
    it('should expand a targeted subset of a fixed group to all members', async () => {
      const core = mkPackage('@wdio/native-core', '2.3.0');
      const utils = mkPackage('@wdio/native-utils', '2.3.0');

      vi.mocked(calculator.calculateVersion).mockImplementation(async (_cfg, opts) => {
        if (opts.name === '@wdio/native-core') {
          return '2.3.1';
        }
        if (opts.name === '@wdio/native-utils') {
          return '2.3.1';
        }
        return '';
      });

      const strategy = createGroupStrategy(
        baseConfig({ groups: { native: { packages: ['@wdio/native-*'], sync: 'fixed' } } }),
      );
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
        if (opts.name === '@app/a') {
          return '1.1.0';
        }
        return '';
      });

      const strategy = createGroupStrategy(baseConfig({ sync: true }));
      await strategy(workspace([a, b]));

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

  describe('per-package graduation (#486) — group atomicity', () => {
    it('should graduate a whole fixed group to stable when ONE member is in graduateScope', async () => {
      const core = mkPackage('@wdio/native-core', '1.0.0-next.5');
      const utils = mkPackage('@wdio/native-utils', '1.0.0-next.5');

      // Simulates applyOverrideScope: in-scope native-core graduates while native-utils advances its prerelease line.
      vi.mocked(calculator.calculateVersion).mockImplementation(async (_cfg, opts) => {
        if (opts.name === '@wdio/native-core') {
          return '1.0.0';
        }
        return '1.0.0-next.6';
      });

      const strategy = createGroupStrategy(
        baseConfig({
          groups: { native: { packages: ['@wdio/native-*'], sync: 'fixed' } },
          stableOnly: true,
          graduateScope: ['@wdio/native-core'],
        }),
      );
      await strategy(workspace([core, utils]));

      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(
        '/ws/packages/wdio-native-core/package.json',
        '1.0.0',
        undefined,
      );
      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(
        '/ws/packages/wdio-native-utils/package.json',
        '1.0.0',
        undefined,
      );
    });

    it('should graduate a whole linked group to stable when one changed member is graduated', async () => {
      const core = mkPackage('@wdio/native-core', '2.0.0-next.2');
      const utils = mkPackage('@wdio/native-utils', '2.0.0-next.2');

      vi.mocked(calculator.calculateVersion).mockImplementation(async (_cfg, opts) => {
        if (opts.name === '@wdio/native-core') {
          return '2.0.0';
        }
        return '2.0.0-next.3';
      });

      const strategy = createGroupStrategy(
        baseConfig({
          groups: { native: { packages: ['@wdio/native-*'], sync: 'linked' } },
          stableOnly: true,
          graduateScope: ['@wdio/native-utils'],
        }),
      );
      await strategy(workspace([core, utils]));

      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(
        '/ws/packages/wdio-native-core/package.json',
        '2.0.0',
        undefined,
      );
      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(
        '/ws/packages/wdio-native-utils/package.json',
        '2.0.0',
        undefined,
      );
    });

    it('should NOT graduate a group when no member is in graduateScope', async () => {
      const core = mkPackage('@wdio/native-core', '1.0.0-next.5');
      const utils = mkPackage('@wdio/native-utils', '1.0.0-next.5');

      vi.mocked(calculator.calculateVersion).mockResolvedValue('1.0.0-next.6');

      const strategy = createGroupStrategy(
        baseConfig({
          groups: { native: { packages: ['@wdio/native-*'], sync: 'fixed' } },
          stableOnly: true,
          graduateScope: ['@other/thing'],
        }),
      );
      await strategy(workspace([core, utils]));

      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(
        '/ws/packages/wdio-native-core/package.json',
        '1.0.0-next.6',
        undefined,
      );
      expect(packageManagement.updatePackageVersion).not.toHaveBeenCalledWith(
        expect.anything(),
        '1.0.0',
        expect.anything(),
      );
    });

    it('should graduate every group under the whole-batch graduate (stableOnly, no graduateScope)', async () => {
      const a = mkPackage('@app/a', '3.1.0-next.4');
      const b = mkPackage('@app/b', '3.1.0-next.4');

      vi.mocked(calculator.calculateVersion).mockResolvedValue('3.1.0');

      const strategy = createGroupStrategy(
        baseConfig({ groups: { app: { packages: ['@app/*'], sync: 'fixed' } }, stableOnly: true }),
      );
      await strategy(workspace([a, b]));

      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(
        '/ws/packages/app-a/package.json',
        '3.1.0',
        undefined,
      );
      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(
        '/ws/packages/app-b/package.json',
        '3.1.0',
        undefined,
      );
    });
  });

  describe('per-package prerelease (#521) — group atomicity', () => {
    it('should shift a whole fixed group onto the prerelease line when a member is in prereleaseScope', async () => {
      const core = mkPackage('@wdio/native-core', '2.3.0');
      const utils = mkPackage('@wdio/native-utils', '2.3.0');

      vi.mocked(calculator.calculateVersion).mockImplementation(async (_cfg, opts) =>
        opts.name === '@wdio/native-core' ? '2.4.0-next.0' : '',
      );

      const strategy = createGroupStrategy(
        baseConfig({
          groups: { native: { packages: ['@wdio/native-*'], sync: 'fixed' } },
          isPrerelease: true,
          prereleaseIdentifier: 'next',
          prereleaseScope: ['@wdio/native-core'],
        }),
      );
      await strategy(workspace([core, utils]));

      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(
        '/ws/packages/wdio-native-core/package.json',
        '2.4.0-next.0',
        undefined,
      );
      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(
        '/ws/packages/wdio-native-utils/package.json',
        '2.4.0-next.0',
        undefined,
      );
    });

    it('should NOT force a group onto the prerelease line when no member is in prereleaseScope', async () => {
      // isPrerelease is global (folded from a scoped request). utils' higher 2.5.0 baseline stops core's stable
      // 2.4.0 from masking a forced 2.6.0-next.0, isolating the isGroupPrereleasing scoping.
      const core = mkPackage('@wdio/native-core', '2.3.0');
      const utils = mkPackage('@wdio/native-utils', '2.5.0');

      vi.mocked(calculator.calculateVersion).mockImplementation(async (_cfg, opts) =>
        opts.name === '@wdio/native-core' ? '2.4.0' : '',
      );

      const strategy = createGroupStrategy(
        baseConfig({
          groups: { native: { packages: ['@wdio/native-*'], sync: 'fixed' } },
          isPrerelease: true,
          prereleaseIdentifier: 'next',
          prereleaseScope: ['@other/thing'],
        }),
      );
      await strategy(workspace([core, utils]));

      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(
        '/ws/packages/wdio-native-core/package.json',
        '2.6.0',
        undefined,
      );
      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(
        '/ws/packages/wdio-native-utils/package.json',
        '2.6.0',
        undefined,
      );
      expect(packageManagement.updatePackageVersion).not.toHaveBeenCalledWith(
        expect.anything(),
        '2.6.0-next.0',
        expect.anything(),
      );
    });

    it('should shift every member of an independent group onto its own prerelease line when the group is scoped', async () => {
      // The wiring expands a scoped member to its whole independent group, so every member is in prereleaseScope.
      const service = mkPackage('@wdio/tauri-service', '1.2.0');
      const plugin = mkPackage('@wdio/tauri-plugin', '0.5.0');

      vi.mocked(calculator.calculateVersion).mockImplementation(async (_cfg, opts) =>
        opts.name === '@wdio/tauri-service' ? '1.3.0-next.0' : '0.6.0-next.0',
      );

      const strategy = createGroupStrategy(
        baseConfig({
          groups: { tauri: { packages: ['@wdio/tauri-*'], sync: 'independent' } },
          isPrerelease: true,
          prereleaseIdentifier: 'next',
          prereleaseScope: ['@wdio/tauri-*'],
        }),
      );
      await strategy(workspace([service, plugin]));

      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(
        '/ws/packages/wdio-tauri-service/package.json',
        '1.3.0-next.0',
        undefined,
      );
      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(
        '/ws/packages/wdio-tauri-plugin/package.json',
        '0.6.0-next.0',
        undefined,
      );
    });
  });

  describe('ungrouped packages', () => {
    it('should version ungrouped packages independently at their own computed version', async () => {
      const core = mkPackage('@wdio/native-core', '2.3.0');
      const standalone = mkPackage('@app/standalone', '5.0.0');

      vi.mocked(calculator.calculateVersion).mockImplementation(async (_cfg, opts) => {
        if (opts.name === '@wdio/native-core') {
          return '2.3.1';
        }
        if (opts.name === '@app/standalone') {
          return '5.1.0';
        }
        return '';
      });

      const strategy = createGroupStrategy(
        baseConfig({ groups: { native: { packages: ['@wdio/native-*'], sync: 'fixed' } } }),
      );
      await strategy(workspace([core, standalone]));

      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(
        '/ws/packages/app-standalone/package.json',
        '5.1.0',
        undefined,
      );
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

  describe('independent groups', () => {
    it('should release each changed member on its own version line (no shared version)', async () => {
      const core = mkPackage('@wdio/native-core', '2.3.0');
      const utils = mkPackage('@wdio/native-utils', '2.3.0');

      vi.mocked(calculator.calculateVersion).mockImplementation(async (_cfg, opts) => {
        if (opts.name === '@wdio/native-core') {
          return '2.4.0';
        }
        if (opts.name === '@wdio/native-utils') {
          return '2.3.1';
        }
        return '';
      });

      const strategy = createGroupStrategy(
        baseConfig({ groups: { native: { packages: ['@wdio/native-*'], sync: 'independent' } } }),
      );
      await strategy(workspace([core, utils]));

      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(
        '/ws/packages/wdio-native-core/package.json',
        '2.4.0',
        undefined,
      );
      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(
        '/ws/packages/wdio-native-utils/package.json',
        '2.3.1',
        undefined,
      );
      // Still tagged with the group name so CI surfaces treat the set as a unit.
      expect(jsonOutput.setPackageUpdateGroup).toHaveBeenCalledWith('@wdio/native-core', 'native');
      expect(jsonOutput.setPackageUpdateGroup).toHaveBeenCalledWith('@wdio/native-utils', 'native');
    });

    it('should skip unchanged members', async () => {
      const core = mkPackage('@wdio/native-core', '2.3.0');
      const utils = mkPackage('@wdio/native-utils', '2.3.0');

      vi.mocked(calculator.calculateVersion).mockImplementation(async (_cfg, opts) =>
        opts.name === '@wdio/native-core' ? '2.4.0' : '',
      );

      const strategy = createGroupStrategy(
        baseConfig({ groups: { native: { packages: ['@wdio/native-*'], sync: 'independent' } } }),
      );
      await strategy(workspace([core, utils]));

      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(
        '/ws/packages/wdio-native-core/package.json',
        '2.4.0',
        undefined,
      );
      expect(packageManagement.updatePackageVersion).not.toHaveBeenCalledWith(
        '/ws/packages/wdio-native-utils/package.json',
        expect.anything(),
        undefined,
      );
      expect(jsonOutput.setPackageUpdateGroup).not.toHaveBeenCalledWith('@wdio/native-utils', 'native');
    });

    it('should warn when an independent group ships without an excluded CHANGED member', async () => {
      const core = mkPackage('@wdio/native-core', '2.3.0');
      const utils = mkPackage('@wdio/native-utils', '2.3.0');
      const spy = mkPackage('@wdio/native-spy', '2.3.0');

      // Dropping a changed member breaks the atomic set.
      vi.mocked(calculator.calculateVersion).mockImplementation(async (_cfg, opts) =>
        opts.name === '@wdio/native-core' || opts.name === '@wdio/native-spy' ? '2.4.0' : '',
      );

      const strategy = createGroupStrategy(
        baseConfig({
          skip: ['@wdio/native-spy'],
          groups: { native: { packages: ['@wdio/native-*'], sync: 'independent' } },
        }),
      );
      await strategy(workspace([core, utils, spy]));

      expect(logging.log).toHaveBeenCalledWith(
        expect.stringContaining('will release without: @wdio/native-spy'),
        'warning',
      );
    });

    it('should NOT warn when an independent group skips an unchanged member', async () => {
      const core = mkPackage('@wdio/native-core', '2.3.0');
      const spy = mkPackage('@wdio/native-spy', '2.3.0');

      // spy had no releasable change, so the set still ships atomically.
      vi.mocked(calculator.calculateVersion).mockImplementation(async (_cfg, opts) =>
        opts.name === '@wdio/native-core' ? '2.4.0' : '',
      );

      const strategy = createGroupStrategy(
        baseConfig({
          skip: ['@wdio/native-spy'],
          groups: { native: { packages: ['@wdio/native-*'], sync: 'independent' } },
        }),
      );
      await strategy(workspace([core, spy]));

      expect(logging.log).not.toHaveBeenCalledWith(expect.stringContaining('will release without'), 'warning');
    });
  });

  describe('synthetic carry entries (#469)', () => {
    it('should flag a lockstep carry synthetic while the changed member keeps real entries', async () => {
      const core = mkPackage('@wdio/native-core', '2.3.0'); // the driver - has a commit
      const utils = mkPackage('@wdio/native-utils', '2.3.0'); // a carry - no commits of its own

      vi.mocked(calculator.calculateVersion).mockImplementation(async (_cfg, opts) =>
        opts.name === '@wdio/native-core' ? '2.4.0' : '',
      );
      vi.mocked(commitParser.extractChangelogEntriesFromCommits, { partial: true }).mockImplementation(
        async (pkgDir: string) =>
          pkgDir.endsWith('native-core') ? [{ type: 'added', description: 'New core feature' }] : [],
      );

      const strategy = createGroupStrategy(
        baseConfig({ groups: { native: { packages: ['@wdio/native-*'], sync: 'fixed' } } }),
      );
      await strategy(workspace([core, utils]));

      expect(jsonOutput.addChangelogData).toHaveBeenCalledWith(
        expect.objectContaining({
          packageName: '@wdio/native-core',
          entries: [{ type: 'added', description: 'New core feature' }],
        }),
      );
      // Synthetic so the preview can collapse it into "Also bumped".
      expect(jsonOutput.addChangelogData).toHaveBeenCalledWith(
        expect.objectContaining({
          packageName: '@wdio/native-utils',
          entries: [expect.objectContaining({ type: 'changed', synthetic: true })],
        }),
      );
    });

    it('should leave a changed member unflagged when its extraction comes back empty (swallowed git failure)', async () => {
      const core = mkPackage('@wdio/native-core', '2.3.0');

      vi.mocked(calculator.calculateVersion).mockResolvedValue('2.4.0');
      // extractChangelogEntriesFromCommits swallows git failures as [], so a changed member can come back empty.
      vi.mocked(commitParser.extractChangelogEntriesFromCommits, { partial: true }).mockResolvedValue([]);

      const strategy = createGroupStrategy(
        baseConfig({ groups: { native: { packages: ['@wdio/native-*'], sync: 'fixed' } } }),
      );
      await strategy(workspace([core]));

      const call = vi
        .mocked(jsonOutput.addChangelogData)
        .mock.calls.find(([arg]) => arg.packageName === '@wdio/native-core');
      expect(call?.[0].entries).toHaveLength(1);
      // No synthetic key, so the bump stays visible rather than collapsed.
      expect(call?.[0].entries[0]).toEqual({
        type: 'changed',
        description: expect.stringContaining('Update version to'),
      });
    });
  });
});
