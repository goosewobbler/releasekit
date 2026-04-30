import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPackageInfo, updatePackageVersion } from '../../../src/package/packageManagement.js';
import * as jsonOutput from '../../../src/utils/jsonOutput.js';
import * as logging from '../../../src/utils/logging.js';

// Mock dependencies
vi.mock('node:fs');
vi.mock('node:path');
vi.mock('../../../src/utils/logging.js');
vi.mock('../../../src/utils/jsonOutput.js');

// Mock process globally
const mockExit = vi.fn() as unknown as typeof process.exit;
const originalProcess = global.process;

describe('Package Management Module', () => {
  const mockPackageContent = {
    name: 'test-package',
    version: '1.0.0',
    description: 'Test package',
    dependencies: {
      'some-dep': '^1.0.0',
    },
  };

  const mockPackagePath = '/path/to/package.json';

  beforeEach(() => {
    vi.resetAllMocks();

    // Setup process.exit mock
    global.process = {
      ...originalProcess,
      exit: mockExit,
    };

    // Setup common mocks
    vi.mocked(path.dirname, { partial: true }).mockImplementation((p) => p.replace('/package.json', ''));
    vi.mocked(fs.existsSync, { partial: true }).mockReturnValue(true);
    vi.mocked(fs.readFileSync, { partial: true }).mockReturnValue(JSON.stringify(mockPackageContent));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    global.process = originalProcess;
  });

  describe('getPackageInfo', () => {
    it('should retrieve package information correctly', () => {
      const result = getPackageInfo(mockPackagePath);

      expect(fs.existsSync).toHaveBeenCalledWith(mockPackagePath);
      expect(fs.readFileSync).toHaveBeenCalledWith(mockPackagePath, 'utf8');

      expect(result).toEqual({
        name: 'test-package',
        version: '1.0.0',
        path: mockPackagePath,
        dir: '/path/to',
        content: mockPackageContent,
      });
    });

    it('should exit if package file not found', () => {
      vi.mocked(fs.existsSync, { partial: true }).mockReturnValue(false);

      try {
        getPackageInfo(mockPackagePath);
        // Fail test if we get here
        expect(true).toBe(false);
      } catch {
        // We expect an error, no need to handle it
      }

      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it('should exit if package name not found', () => {
      vi.mocked(fs.readFileSync, { partial: true }).mockReturnValue(JSON.stringify({ version: '1.0.0' }));

      try {
        getPackageInfo(mockPackagePath);
        // Fail test if we get here
        expect(true).toBe(false);
      } catch {
        // We expect an error, no need to handle it
      }

      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it('should handle read errors', () => {
      const error = new Error('Failed to read file');
      vi.mocked(fs.readFileSync, { partial: true }).mockImplementation(() => {
        throw error;
      });

      try {
        getPackageInfo(mockPackagePath);
        // Fail test if we get here
        expect(true).toBe(false);
      } catch {
        // We expect an error, no need to handle it
      }

      expect(logging.log).toHaveBeenCalledWith(`Error reading package: ${mockPackagePath}`, 'error');
      expect(logging.log).toHaveBeenCalledWith(error.message, 'error');
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it('should use 0.0.0 as default version if not specified', () => {
      vi.mocked(fs.readFileSync, { partial: true }).mockReturnValue(JSON.stringify({ name: 'no-version-pkg' }));

      const result = getPackageInfo(mockPackagePath);
      expect(result.version).toBe('0.0.0');
    });
  });

  describe('updatePackageVersion', () => {
    beforeEach(() => {
      vi.mocked(fs.writeFileSync, { partial: true }).mockClear();
      vi.mocked(jsonOutput.addPackageUpdate, { partial: true }).mockClear();
    });

    it('should update package version correctly', () => {
      const newVersion = '2.0.0';

      updatePackageVersion(mockPackagePath, newVersion);

      // Check that file was read and written
      expect(fs.readFileSync).toHaveBeenCalledWith(mockPackagePath, 'utf8');
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        mockPackagePath,
        `${JSON.stringify({ ...mockPackageContent, version: newVersion }, null, 2)}\n`,
      );

      // Check that the update was logged and tracked
      expect(logging.log).toHaveBeenCalledWith(
        `Updated package.json at ${mockPackagePath} to version ${newVersion}`,
        'success',
      );
      expect(jsonOutput.addPackageUpdate).toHaveBeenCalledWith('test-package', newVersion, mockPackagePath);
    });

    it('should not write to disk when dryRun is true', () => {
      const newVersion = '2.0.0';

      updatePackageVersion(mockPackagePath, newVersion, true);

      // Should NOT write to the file
      expect(fs.writeFileSync).not.toHaveBeenCalled();

      // Should record a pending write instead
      expect(jsonOutput.recordPendingWrite).toHaveBeenCalledWith(
        mockPackagePath,
        `${JSON.stringify({ ...mockPackageContent, version: newVersion }, null, 2)}\n`,
      );

      // Should still track the update and log
      expect(jsonOutput.addPackageUpdate).toHaveBeenCalledWith('test-package', newVersion, mockPackagePath);
      expect(logging.log).toHaveBeenCalledWith(
        `[DRY RUN] Would update package.json at ${mockPackagePath} to version ${newVersion}`,
        'success',
      );
    });

    it('should write to disk when dryRun is false', () => {
      const newVersion = '2.0.0';

      updatePackageVersion(mockPackagePath, newVersion, false);

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        mockPackagePath,
        `${JSON.stringify({ ...mockPackageContent, version: newVersion }, null, 2)}\n`,
      );
      expect(jsonOutput.addPackageUpdate).toHaveBeenCalledWith('test-package', newVersion, mockPackagePath);
    });

    it('should handle errors when updating package version', () => {
      const newVersion = '2.0.0';
      const error = new Error('Failed to write file');

      // Mock the write operation to throw an error
      vi.mocked(fs.writeFileSync, { partial: true }).mockImplementation(() => {
        throw error;
      });

      expect(() => updatePackageVersion(mockPackagePath, newVersion)).toThrow(error);

      expect(logging.log).toHaveBeenCalledWith(`Failed to update package.json at ${mockPackagePath}`, 'error');
      expect(logging.log).toHaveBeenCalledWith(error.message, 'error');
    });
  });
});
