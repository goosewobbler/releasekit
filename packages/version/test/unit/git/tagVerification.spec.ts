import { beforeEach, describe, expect, it, vi } from 'vitest';
import { execSync } from '../../../src/git/commandExecutor.js';
import { verifyTag } from '../../../src/git/tagVerification.js';
import { log } from '../../../src/utils/logging.js';
import { getBestVersionSource, VersionMismatchError } from '../../../src/utils/versionUtils.js';

// Mock dependencies
vi.mock('../../../src/git/commandExecutor.js');
vi.mock('../../../src/utils/logging.js');

const mockExecSync = vi.mocked(execSync);
const mockLog = vi.mocked(log);

describe('Tag Verification', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockLog.mockImplementation(() => {}); // Silent by default
  });

  describe('verifyTag', () => {
    it('should return exists: true when tag exists and is reachable', () => {
      mockExecSync.mockImplementation(() => Buffer.from('abc123'));

      const result = verifyTag('v1.0.0', '/test/path');

      expect(result).toEqual({
        exists: true,
        reachable: true,
      });
      expect(mockExecSync).toHaveBeenCalledWith('git', ['rev-parse', '--verify', 'v1.0.0'], {
        cwd: '/test/path',
        stdio: 'ignore',
      });
    });

    it('should return exists: false when tag does not exist', () => {
      const error = new Error('unknown revision or path not in the working tree');
      mockExecSync.mockImplementation(() => {
        throw error;
      });

      const result = verifyTag('v1.0.0', '/test/path');

      expect(result).toEqual({
        exists: false,
        reachable: false,
        error: "Tag 'v1.0.0' not found in repository",
      });
    });

    it('should return exists: false for bad revision errors', () => {
      const error = new Error("bad revision 'v1.0.0'");
      mockExecSync.mockImplementation(() => {
        throw error;
      });

      const result = verifyTag('v1.0.0', '/test/path');

      expect(result).toEqual({
        exists: false,
        reachable: false,
        error: "Tag 'v1.0.0' not found in repository",
      });
    });

    it('should return exists: false for "No such ref" errors', () => {
      const error = new Error('No such ref: v1.0.0');
      mockExecSync.mockImplementation(() => {
        throw error;
      });

      const result = verifyTag('v1.0.0', '/test/path');

      expect(result).toEqual({
        exists: false,
        reachable: false,
        error: "Tag 'v1.0.0' not found in repository",
      });
    });

    it('should return exists: false for other git errors', () => {
      const error = new Error('fatal: not a git repository');
      mockExecSync.mockImplementation(() => {
        throw error;
      });

      const result = verifyTag('v1.0.0', '/test/path');

      expect(result).toEqual({
        exists: false,
        reachable: false,
        error: 'Git error: fatal: not a git repository',
      });
    });

    it('should return exists: false for empty tag name', () => {
      const result = verifyTag('', '/test/path');

      expect(result).toEqual({
        exists: false,
        reachable: false,
        error: 'Empty tag name',
      });
      expect(mockExecSync).not.toHaveBeenCalled();
    });

    it('should return exists: false for whitespace-only tag name', () => {
      const result = verifyTag('   ', '/test/path');

      expect(result).toEqual({
        exists: false,
        reachable: false,
        error: 'Empty tag name',
      });
      expect(mockExecSync).not.toHaveBeenCalled();
    });
  });

  describe('getBestVersionSource', () => {
    beforeEach(() => {
      // Reset mocks for each test
      vi.resetAllMocks();
    });

    it('should use package version when it is newer than git tag', async () => {
      // Mock execSync to succeed (tag exists)
      mockExecSync.mockImplementation(() => Buffer.from('abc123'));

      const result = await getBestVersionSource('v1.0.0', '1.1.0', '/test/path');

      expect(result).toEqual({
        source: 'package',
        version: '1.1.0',
        reason: 'Package version is newer',
      });
      expect(mockLog).toHaveBeenCalledWith(
        'Package version 1.1.0 is newer than git tag v1.0.0, using package version',
        'info',
      );
    });

    it('should use git tag when it is newer than package version', async () => {
      // Mock execSync to succeed (tag exists)
      mockExecSync.mockImplementation(() => Buffer.from('abc123'));

      const result = await getBestVersionSource('v1.2.0', '1.0.0', '/test/path', 'warn');

      expect(result.source).toBe('git');
      expect(result.version).toBe('v1.2.0');
      expect(result.reason).toBe('Git tag is newer');
      expect(result.mismatch).toBeDefined();
      expect(result.mismatch?.detected).toBe(true);
      expect(result.mismatch?.severity).toBe('major');
      expect(mockLog).toHaveBeenCalledWith('Git tag v1.2.0 is newer than package version 1.0.0, using git tag', 'info');
    });

    it('should use git tag when versions are equal', async () => {
      // Mock execSync to succeed (tag exists)
      mockExecSync.mockImplementation(() => Buffer.from('abc123'));

      const result = await getBestVersionSource('v1.0.0', '1.0.0', '/test/path');

      expect(result).toEqual({
        source: 'git',
        version: 'v1.0.0',
        reason: 'Versions equal, using git tag',
      });
    });

    it('should fallback to package version when tag is unreachable', async () => {
      // Mock execSync to fail (tag doesn't exist)
      mockExecSync.mockImplementation(() => {
        throw new Error('unknown revision or path not in the working tree');
      });

      const result = await getBestVersionSource('v1.0.0', '1.0.0', '/test/path');

      expect(result).toEqual({
        source: 'package',
        version: '1.0.0',
        reason: 'Git tag unreachable',
      });
      expect(mockLog).toHaveBeenCalledWith(
        "Git tag 'v1.0.0' unreachable (Tag 'v1.0.0' not found in repository), using package version: 1.0.0",
        'warning',
      );
    });

    it('should use package version when no tag provided', async () => {
      const result = await getBestVersionSource(undefined, '1.0.0', '/test/path');

      expect(result).toEqual({
        source: 'package',
        version: '1.0.0',
        reason: 'No git tag provided',
      });
    });

    it('should use initial version when no tag and no package version', async () => {
      const result = await getBestVersionSource(undefined, undefined, '/test/path');

      expect(result).toEqual({
        source: 'initial',
        version: '0.1.0',
        reason: 'No git tag or package version available',
      });
    });

    it('should use initial version when tag unreachable and no package version', async () => {
      // Mock execSync to fail (tag doesn't exist)
      mockExecSync.mockImplementation(() => {
        throw new Error('unknown revision or path not in the working tree');
      });

      const result = await getBestVersionSource('v1.0.0', undefined, '/test/path');

      expect(result).toEqual({
        source: 'initial',
        version: '0.1.0',
        reason: 'Git tag unreachable, no package version',
      });
      expect(mockLog).toHaveBeenCalledWith(
        "Git tag 'v1.0.0' unreachable and no package version available, using initial version",
        'warning',
      );
    });

    it('should handle empty tag string', async () => {
      const result = await getBestVersionSource('', '1.0.0', '/test/path');

      expect(result).toEqual({
        source: 'package',
        version: '1.0.0',
        reason: 'No git tag provided',
      });
    });

    it('should handle whitespace-only tag string', async () => {
      const result = await getBestVersionSource('   ', '1.0.0', '/test/path');

      expect(result).toEqual({
        source: 'package',
        version: '1.0.0',
        reason: 'No git tag provided',
      });
    });

    it('should handle package-specific tags correctly', async () => {
      // Mock execSync to succeed (tag exists)
      mockExecSync.mockImplementation(() => Buffer.from('abc123'));

      const result = await getBestVersionSource('my-package@v1.0.0', '1.1.0', '/test/path');

      expect(result).toEqual({
        source: 'package',
        version: '1.1.0',
        reason: 'Package version is newer',
      });
    });

    it('should fallback to git tag when version comparison fails', async () => {
      // Mock execSync to succeed (tag exists)
      mockExecSync.mockImplementation(() => Buffer.from('abc123'));

      const result = await getBestVersionSource('v1.0.0', 'invalid-version', '/test/path');

      expect(result).toEqual({
        source: 'git',
        version: 'v1.0.0',
        reason: 'Version comparison failed',
      });
      expect(mockLog).toHaveBeenCalledWith(
        'Failed to compare versions, defaulting to git tag: TypeError: Invalid Version: invalid-version',
        'warning',
      );
    });

    it('should use git tag when no package version to compare', async () => {
      // Mock execSync to succeed (tag exists)
      mockExecSync.mockImplementation(() => Buffer.from('abc123'));

      const result = await getBestVersionSource('v1.0.0', undefined, '/test/path');

      expect(result).toEqual({
        source: 'git',
        version: 'v1.0.0',
        reason: 'Git tag exists, no package version to compare',
      });
    });

    describe('version mismatch detection', () => {
      it('should detect mismatch when git tag is stable but package is prerelease (same major)', async () => {
        // Mock execSync to succeed (tag exists)
        mockExecSync.mockImplementation(() => Buffer.from('abc123'));

        const result = await getBestVersionSource('v1.0.0', '1.0.0-beta.1', '/test/path', 'warn');

        expect(result.source).toBe('git');
        expect(result.version).toBe('v1.0.0');
        expect(result.mismatch?.detected).toBe(true);
        expect(result.mismatch?.severity).toBe('major');
        expect(result.mismatch?.message).toContain('reverted release');
      });

      it('should use prefer-package strategy to use package version on mismatch', async () => {
        // Mock execSync to succeed (tag exists)
        mockExecSync.mockImplementation(() => Buffer.from('abc123'));

        const result = await getBestVersionSource('v1.0.0', '1.0.0-beta.1', '/test/path', 'prefer-package');

        expect(result.source).toBe('package');
        expect(result.version).toBe('1.0.0-beta.1');
        expect(result.reason).toContain('package version');
      });

      it('should throw VersionMismatchError on mismatch with error strategy', async () => {
        // Mock execSync to succeed (tag exists)
        mockExecSync.mockImplementation(() => Buffer.from('abc123'));

        await expect(getBestVersionSource('v1.0.0', '1.0.0-beta.1', '/test/path', 'error')).rejects.toThrow(
          VersionMismatchError,
        );
      });

      it('should throw VersionMismatchError by default (error is the default strategy)', async () => {
        // Mock execSync to succeed (tag exists)
        mockExecSync.mockImplementation(() => Buffer.from('abc123'));

        await expect(getBestVersionSource('v1.0.0', '1.0.0-beta.1', '/test/path')).rejects.toThrow(
          VersionMismatchError,
        );
      });

      it('should detect major version difference as significant mismatch', async () => {
        // Mock execSync to succeed (tag exists)
        mockExecSync.mockImplementation(() => Buffer.from('abc123'));

        const result = await getBestVersionSource('v2.0.0', '1.0.0', '/test/path', 'warn');

        expect(result.source).toBe('git');
        expect(result.mismatch?.detected).toBe(true);
        expect(result.mismatch?.severity).toBe('major');
      });

      it('should detect minor version difference as significant mismatch', async () => {
        // Mock execSync to succeed (tag exists)
        mockExecSync.mockImplementation(() => Buffer.from('abc123'));

        const result = await getBestVersionSource('v1.5.0', '1.0.0', '/test/path', 'warn');

        expect(result.source).toBe('git');
        expect(result.mismatch?.detected).toBe(true);
        expect(result.mismatch?.severity).toBe('major');
      });

      it('should not flag patch difference as major mismatch', async () => {
        // Mock execSync to succeed (tag exists)
        mockExecSync.mockImplementation(() => Buffer.from('abc123'));

        const result = await getBestVersionSource('v1.0.5', '1.0.0', '/test/path');

        expect(result.source).toBe('git');
        expect(result.mismatch?.detected).toBeFalsy();
      });

      it('should use package version when it is newer than prerelease tag', async () => {
        // Mock execSync to succeed (tag exists)
        mockExecSync.mockImplementation(() => Buffer.from('abc123'));

        // Package 1.0.0 is greater than tag 1.0.0-beta.1
        const result = await getBestVersionSource('v1.0.0-beta.1', '1.0.0', '/test/path', 'warn');

        expect(result.source).toBe('package');
        expect(result.version).toBe('1.0.0');
        expect(result.reason).toBe('Package version is newer');
      });

      it('should support ignore strategy (silent)', async () => {
        // Mock execSync to succeed (tag exists)
        mockExecSync.mockImplementation(() => Buffer.from('abc123'));
        mockLog.mockClear();

        const result = await getBestVersionSource('v2.0.0', '1.0.0', '/test/path', 'ignore');

        expect(result.source).toBe('git');
        // Should not log warnings with ignore strategy
        const warningCalls = mockLog.mock.calls.filter((call) => call[1] === 'warning');
        expect(warningCalls.length).toBe(0);
      });

      it('should support prefer-git strategy explicitly', async () => {
        // Mock execSync to succeed (tag exists)
        mockExecSync.mockImplementation(() => Buffer.from('abc123'));

        const result = await getBestVersionSource('v1.0.0', '1.0.0-beta.1', '/test/path', 'prefer-git');

        expect(result.source).toBe('git');
        expect(result.version).toBe('v1.0.0');
        expect(result.reason).toContain('git tag per strategy');
        expect(result.mismatch?.detected).toBe(true);
      });
    });
  });
});
