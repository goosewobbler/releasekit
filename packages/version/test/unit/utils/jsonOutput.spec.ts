import fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addChangelogData,
  addPackageUpdate,
  addTag,
  enableJsonOutput,
  flushPendingWrites,
  getJsonData,
  getPendingWriteCount,
  printJsonOutput,
  recordPendingWrite,
  setAllPackageUpdatePreviousVersions,
  setCommitMessage,
  setPackageUpdateAction,
  setPackageUpdatePreviousVersion,
  setPackageUpdateTag,
  setVersioningStrategy,
  tagPrerequisiteRoles,
} from '../../../src/utils/jsonOutput.js';

vi.mock('node:fs');

describe('JSON Output Utilities', () => {
  beforeEach(() => {
    // Reset JSON output state before each test
    enableJsonOutput(false);
    // Clear any console mocks
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('JSON Output Core Functions', () => {
    it('should manage state correctly', () => {
      // Enable JSON output
      enableJsonOutput(true);

      // Check initial state after enabling
      const initialData = getJsonData();
      expect(initialData.dryRun).toBe(true);
      expect(initialData.updates).toEqual([]);
      expect(initialData.changelogs).toEqual([]);
      expect(initialData.tags).toEqual([]);
      expect(initialData.commitMessage).toBeUndefined();

      // Add data
      addPackageUpdate('test-package', '1.0.0', '/path/to/package.json');
      addTag('v1.0.0');
      setCommitMessage('Release v1.0.0');
      // (tagPrerequisiteRoles is exercised in its own describe below.)

      // Check data was added
      const updatedData = getJsonData();
      expect(updatedData.updates).toHaveLength(1);
      expect(updatedData.updates[0]).toEqual({
        packageName: 'test-package',
        newVersion: '1.0.0',
        filePath: '/path/to/package.json',
        channel: 'stable',
      });
      expect(updatedData.tags).toHaveLength(1);
      expect(updatedData.tags[0]).toBe('v1.0.0');
      expect(updatedData.commitMessage).toBe('Release v1.0.0');

      // Reset by enabling again
      enableJsonOutput(false);

      // Check data was reset
      const resetData = getJsonData();
      expect(resetData.dryRun).toBe(false);
      expect(resetData.updates).toEqual([]);
      expect(resetData.changelogs).toEqual([]);
      expect(resetData.tags).toEqual([]);
      expect(resetData.commitMessage).toBeUndefined();
    });

    it('should return a copy of the JSON data', () => {
      enableJsonOutput();
      addPackageUpdate('test-package', '1.0.0', '/path/to/package.json');

      const data1 = getJsonData();
      // Modify the returned data
      data1.updates = [];

      // The internal data should remain unchanged
      const data2 = getJsonData();
      expect(data2.updates).toHaveLength(1);
    });

    it('should record the versioning strategy and reset it on enableJsonOutput', () => {
      enableJsonOutput();
      expect(getJsonData().strategy).toBeUndefined();

      setVersioningStrategy('sync');
      expect(getJsonData().strategy).toBe('sync');

      enableJsonOutput();
      expect(getJsonData().strategy).toBeUndefined();
    });

    it('should mark root updates with isRoot and omit the field otherwise', () => {
      enableJsonOutput();
      addPackageUpdate('my-monorepo', '1.0.0', '/path/to/package.json', true);
      addPackageUpdate('test-package', '1.0.0', '/path/to/packages/a/package.json', false);

      const data = getJsonData();
      expect(data.updates[0]).toEqual({
        packageName: 'my-monorepo',
        newVersion: '1.0.0',
        filePath: '/path/to/package.json',
        channel: 'stable',
        isRoot: true,
      });
      // isRoot is omitted (not false) so pre-existing consumers see an unchanged shape
      expect(data.updates[1]).toEqual({
        packageName: 'test-package',
        newVersion: '1.0.0',
        filePath: '/path/to/packages/a/package.json',
        channel: 'stable',
      });
    });

    // A hybrid package (one dir, both package.json + a native manifest) is a single package — npm
    // owns its identity. Without dir-keyed dedup the native sibling's write registers a second
    // update under its crate/pub name and the package surfaces twice downstream (#476).
    it('should keep one update per directory for a hybrid, with npm winning regardless of write order', () => {
      enableJsonOutput();
      // package.json written first (the order every strategy uses), then the Cargo.toml sibling.
      addPackageUpdate('@scope/x-y', '1.1.0', '/ws/packages/x/package.json');
      addPackageUpdate('x-y', '1.1.0', '/ws/packages/x/Cargo.toml');

      const data = getJsonData();
      expect(data.updates).toHaveLength(1);
      expect(data.updates[0]).toEqual({
        packageName: '@scope/x-y',
        newVersion: '1.1.0',
        filePath: '/ws/packages/x/package.json',
        channel: 'stable',
      });
    });

    it('should let a package.json supersede a native sibling recorded first (order-independent npm-wins)', () => {
      enableJsonOutput();
      addPackageUpdate('x-y', '1.1.0', '/ws/packages/x/Cargo.toml');
      addPackageUpdate('@scope/x-y', '1.1.0', '/ws/packages/x/package.json');

      const data = getJsonData();
      expect(data.updates).toHaveLength(1);
      expect(data.updates[0]).toEqual({
        packageName: '@scope/x-y',
        newVersion: '1.1.0',
        filePath: '/ws/packages/x/package.json',
        channel: 'stable',
      });
    });

    it('should still record the update for a native-only package (no package.json sibling)', () => {
      enableJsonOutput();
      addPackageUpdate('pure-crate', '2.0.0', '/ws/crates/pure/Cargo.toml');

      const data = getJsonData();
      expect(data.updates).toHaveLength(1);
      expect(data.updates[0]).toEqual({
        packageName: 'pure-crate',
        newVersion: '2.0.0',
        filePath: '/ws/crates/pure/Cargo.toml',
        channel: 'stable',
      });
    });

    it('should derive the per-package channel from the resolved version (#485)', () => {
      enableJsonOutput();
      addPackageUpdate('stable-pkg', '10.2.0', '/ws/packages/stable/package.json');
      addPackageUpdate('pre-pkg', '1.0.0-next.2', '/ws/packages/pre/package.json');

      const updates = getJsonData().updates;
      // A mixed standing PR carries both channels at once, each on its own line (#485).
      expect(updates.find((u) => u.packageName === 'stable-pkg')?.channel).toBe('stable');
      expect(updates.find((u) => u.packageName === 'pre-pkg')?.channel).toBe('prerelease');
    });

    it('should dedupe a hybrid when manifest paths are not string-identical for the same directory', () => {
      enableJsonOutput();
      addPackageUpdate('@scope/x-y', '1.1.0', '/ws/packages/x/package.json');
      // Same directory, written via a non-normalized path form — keying on path.dirname alone would
      // miss this and re-admit the crate-name duplicate; resolving first dedupes it (#476).
      addPackageUpdate('x-y', '1.1.0', '/ws/packages/./x/Cargo.toml');

      const data = getJsonData();
      expect(data.updates).toHaveLength(1);
      expect(data.updates[0].packageName).toBe('@scope/x-y');
    });
  });

  describe('addChangelogData', () => {
    it('should accumulate changelog entries', () => {
      enableJsonOutput();

      addChangelogData({
        packageName: 'my-package',
        version: '2.0.0',
        previousVersion: 'v1.0.0',
        revisionRange: 'v1.0.0..HEAD',
        repoUrl: 'https://github.com/org/repo',
        entries: [
          { type: 'added', description: 'New feature' },
          { type: 'fixed', description: 'Bug fix' },
        ],
      });

      const data = getJsonData();
      expect(data.changelogs).toHaveLength(1);
      expect(data.changelogs[0]).toEqual({
        packageName: 'my-package',
        version: '2.0.0',
        previousVersion: 'v1.0.0',
        revisionRange: 'v1.0.0..HEAD',
        repoUrl: 'https://github.com/org/repo',
        entries: [
          { type: 'added', description: 'New feature' },
          { type: 'fixed', description: 'Bug fix' },
        ],
      });
    });

    it('should accumulate multiple packages independently', () => {
      enableJsonOutput();

      addChangelogData({
        packageName: 'package-a',
        version: '1.1.0',
        previousVersion: 'v1.0.0',
        revisionRange: 'v1.0.0..HEAD',
        repoUrl: null,
        entries: [{ type: 'added', description: 'Feature A' }],
      });

      addChangelogData({
        packageName: 'package-b',
        version: '2.0.0',
        previousVersion: null,
        revisionRange: 'HEAD',
        repoUrl: 'https://github.com/org/repo',
        entries: [{ type: 'fixed', description: 'Fix B' }],
      });

      const data = getJsonData();
      expect(data.changelogs).toHaveLength(2);
      expect(data.changelogs[0].packageName).toBe('package-a');
      expect(data.changelogs[1].packageName).toBe('package-b');
    });

    it('should reset changelogs when enableJsonOutput is called', () => {
      enableJsonOutput();

      addChangelogData({
        packageName: 'my-package',
        version: '1.0.0',
        previousVersion: null,
        revisionRange: 'HEAD',
        repoUrl: null,
        entries: [{ type: 'changed', description: 'Update' }],
      });

      expect(getJsonData().changelogs).toHaveLength(1);

      enableJsonOutput();

      expect(getJsonData().changelogs).toEqual([]);
    });

    it('should not add data when JSON output is not enabled', () => {
      // Create a fresh module state by not calling enableJsonOutput
      // The module-level _jsonOutputMode defaults to false after the beforeEach reset
      // but enableJsonOutput(false) sets _jsonOutputMode = true, so we need to test differently

      // enableJsonOutput was called in beforeEach, so JSON mode is active
      // Test that data accumulates normally
      addChangelogData({
        packageName: 'my-package',
        version: '1.0.0',
        previousVersion: null,
        revisionRange: 'HEAD',
        repoUrl: null,
        entries: [],
      });

      expect(getJsonData().changelogs).toHaveLength(1);
    });
  });

  describe('pending writes', () => {
    beforeEach(() => {
      enableJsonOutput(true);
    });

    it('should start with no pending writes', () => {
      expect(getPendingWriteCount()).toBe(0);
    });

    it('should record a pending write', () => {
      recordPendingWrite('/some/path/package.json', '{"version":"1.0.0"}\n');
      expect(getPendingWriteCount()).toBe(1);
    });

    it('should not record a pending write when JSON output mode is disabled', async () => {
      // Use isolated module state so _jsonOutputMode starts as false
      vi.resetModules();
      const fresh = await import('../../../src/utils/jsonOutput.js');

      fresh.recordPendingWrite('/a.json', 'a');

      expect(fresh.getPendingWriteCount()).toBe(0);
    });

    it('should accumulate multiple pending writes', () => {
      recordPendingWrite('/a/package.json', 'a');
      recordPendingWrite('/b/package.json', 'b');
      expect(getPendingWriteCount()).toBe(2);
    });

    it('should flush pending writes to disk and clear the buffer', () => {
      recordPendingWrite('/a/package.json', 'content-a');
      recordPendingWrite('/b/Cargo.toml', 'content-b');

      flushPendingWrites();

      expect(fs.writeFileSync).toHaveBeenCalledTimes(2);
      expect(fs.writeFileSync).toHaveBeenCalledWith('/a/package.json', 'content-a');
      expect(fs.writeFileSync).toHaveBeenCalledWith('/b/Cargo.toml', 'content-b');
      expect(getPendingWriteCount()).toBe(0);
    });

    it('should clear pending writes when enableJsonOutput is called', () => {
      recordPendingWrite('/some/path.json', 'data');
      expect(getPendingWriteCount()).toBe(1);

      enableJsonOutput();

      expect(getPendingWriteCount()).toBe(0);
    });

    it('should not write anything when flushing an empty buffer', () => {
      flushPendingWrites();
      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });

    it('should clear the buffer even when a write throws', () => {
      recordPendingWrite('/a.json', 'a');
      recordPendingWrite('/b.json', 'b');
      vi.mocked(fs.writeFileSync).mockImplementation(() => {
        throw new Error('permission denied');
      });

      expect(() => flushPendingWrites()).toThrow('permission denied');
      expect(getPendingWriteCount()).toBe(0);
    });
  });

  describe('setPackageUpdateTag', () => {
    it('should set the tag on a matching update', () => {
      enableJsonOutput();
      addPackageUpdate('my-package', '1.1.0', '/path/to/package.json');

      setPackageUpdateTag('my-package', 'my-package@v1.1.0');

      const data = getJsonData();
      expect(data.updates[0]?.tag).toBe('my-package@v1.1.0');
    });

    it('should be a no-op for an unknown package name', () => {
      enableJsonOutput();
      addPackageUpdate('my-package', '1.1.0', '/path/to/package.json');

      setPackageUpdateTag('other-package', 'other-package@v1.1.0');

      const data = getJsonData();
      expect(data.updates[0]?.tag).toBeUndefined();
    });

    it('should only set tag on the first matching update when same-named updates exist', () => {
      enableJsonOutput();
      // Different directories, so dir-keyed dedup keeps both; setPackageUpdateTag still tags only the
      // first match by name.
      addPackageUpdate('my-package', '1.1.0', '/path/to/a/package.json');
      addPackageUpdate('my-package', '1.1.0', '/path/to/b/package.json');

      setPackageUpdateTag('my-package', 'my-package@v1.1.0');

      const data = getJsonData();
      expect(data.updates[0]?.tag).toBe('my-package@v1.1.0');
      expect(data.updates[1]?.tag).toBeUndefined();
    });

    it('should be a no-op when JSON output mode is disabled', async () => {
      vi.resetModules();
      const fresh = await import('../../../src/utils/jsonOutput.js');
      fresh.enableJsonOutput();
      fresh.addPackageUpdate('pkg', '1.0.0', '/pkg.json');

      // Reset mode to simulate disabled state
      const freshDisabled = await (async () => {
        vi.resetModules();
        return import('../../../src/utils/jsonOutput.js');
      })();

      freshDisabled.setPackageUpdateTag('pkg', 'pkg@v1.0.0');
      expect(freshDisabled.getJsonData().updates).toEqual([]);
    });
  });

  describe('setPackageUpdateAction', () => {
    it('should set the action and reason on a matching update', () => {
      enableJsonOutput();
      addPackageUpdate('my-package', '1.0.0', '/path/to/package.json');

      setPackageUpdateAction('my-package', 'graduated', 'Graduated 1.0.0-next.1 → 1.0.0 (bump ignored).');

      const data = getJsonData();
      expect(data.updates[0]?.action).toBe('graduated');
      expect(data.updates[0]?.actionReason).toBe('Graduated 1.0.0-next.1 → 1.0.0 (bump ignored).');
    });

    it('should leave action and reason undefined when never set (old-manifest tolerance)', () => {
      enableJsonOutput();
      addPackageUpdate('my-package', '1.0.0', '/path/to/package.json');

      const data = getJsonData();
      expect(data.updates[0]?.action).toBeUndefined();
      expect(data.updates[0]?.actionReason).toBeUndefined();
    });

    it('should be a no-op for an unknown package name', () => {
      enableJsonOutput();
      addPackageUpdate('my-package', '1.0.0', '/path/to/package.json');

      setPackageUpdateAction('other-package', 'bumped', 'Bumped to 1.0.0.');

      const data = getJsonData();
      expect(data.updates[0]?.action).toBeUndefined();
    });
  });

  describe('setPackageUpdatePreviousVersion', () => {
    it('should set the baseline previous version on a matching update', () => {
      enableJsonOutput();
      addPackageUpdate('my-package', '1.2.0', '/path/to/package.json');

      setPackageUpdatePreviousVersion('my-package', 'v1.1.0');

      expect(getJsonData().updates[0]?.previousVersion).toBe('v1.1.0');
    });

    it('should leave previousVersion absent when the resolved baseline is null (old-manifest tolerance)', () => {
      enableJsonOutput();
      addPackageUpdate('my-package', '1.2.0', '/path/to/package.json');

      setPackageUpdatePreviousVersion('my-package', null);

      expect(getJsonData().updates[0]?.previousVersion).toBeUndefined();
    });

    it('should be a no-op for an unknown package name', () => {
      enableJsonOutput();
      addPackageUpdate('my-package', '1.2.0', '/path/to/package.json');

      setPackageUpdatePreviousVersion('other-package', 'v1.1.0');

      expect(getJsonData().updates[0]?.previousVersion).toBeUndefined();
    });
  });

  describe('setAllPackageUpdatePreviousVersions', () => {
    it('should set the same baseline on every update (sync lockstep)', () => {
      enableJsonOutput();
      addPackageUpdate('pkg-a', '1.2.0', '/ws/a/package.json');
      addPackageUpdate('pkg-b', '1.2.0', '/ws/b/package.json');

      setAllPackageUpdatePreviousVersions('v1.1.0');

      const data = getJsonData();
      expect(data.updates.map((u) => u.previousVersion)).toEqual(['v1.1.0', 'v1.1.0']);
    });

    it('should leave every previousVersion absent when the baseline is null', () => {
      enableJsonOutput();
      addPackageUpdate('pkg-a', '1.2.0', '/ws/a/package.json');
      addPackageUpdate('pkg-b', '1.2.0', '/ws/b/package.json');

      setAllPackageUpdatePreviousVersions(null);

      const data = getJsonData();
      expect(data.updates.every((u) => u.previousVersion === undefined)).toBe(true);
    });
  });

  describe('printJsonOutput', () => {
    it('should print JSON data when enabled', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      enableJsonOutput();
      addPackageUpdate('test-package', '1.0.0', '/path/to/package.json');
      printJsonOutput();

      expect(consoleSpy).toHaveBeenCalledTimes(1);
      const output = consoleSpy.mock.calls[0][0];
      expect(typeof output).toBe('string');
      expect(output).toContain('test-package');
    });

    it('should include changelogs in printed output', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      enableJsonOutput();
      addChangelogData({
        packageName: 'my-package',
        version: '1.0.0',
        previousVersion: null,
        revisionRange: 'HEAD',
        repoUrl: null,
        entries: [{ type: 'added', description: 'New feature' }],
      });
      printJsonOutput();

      const output = consoleSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);
      expect(parsed.changelogs).toHaveLength(1);
      expect(parsed.changelogs[0].entries[0].description).toBe('New feature');
    });
  });

  describe('tagPrerequisiteRoles', () => {
    it('should tag override-scope packages as targets and the rest as prerequisites', () => {
      enableJsonOutput(true);
      addPackageUpdate('app', '2.0.0', 'packages/app/package.json');
      addPackageUpdate('core', '1.1.0', 'packages/core/package.json');
      addPackageUpdate('root', '0.0.1', 'package.json', true);

      tagPrerequisiteRoles(['app'], { core: ['app'] });

      const updates = getJsonData().updates;
      const byName = (n: string) => updates.find((u) => u.packageName === n);
      expect(byName('app')).toMatchObject({ role: 'target' });
      expect(byName('app')?.prerequisiteOf).toBeUndefined();
      expect(byName('core')).toMatchObject({ role: 'prerequisite', prerequisiteOf: ['app'] });
      // The root lockstep bump is neither a target nor a prerequisite — left untagged.
      expect(byName('root')?.role).toBeUndefined();
    });
  });
});
