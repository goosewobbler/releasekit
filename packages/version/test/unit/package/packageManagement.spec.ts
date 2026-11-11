import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { updatePackageVersion } from '../../../src/package/packageManagement.js';
import * as jsonOutput from '../../../src/utils/jsonOutput.js';
import * as logging from '../../../src/utils/logging.js';

vi.mock('node:fs');
vi.mock('node:path');
vi.mock('../../../src/utils/logging.js');
vi.mock('../../../src/utils/jsonOutput.js');

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

    global.process = {
      ...originalProcess,
      exit: mockExit,
    };

    vi.mocked(path.dirname, { partial: true }).mockImplementation((p) => p.replace('/package.json', ''));
    vi.mocked(fs.existsSync, { partial: true }).mockReturnValue(true);
    vi.mocked(fs.readFileSync, { partial: true }).mockReturnValue(JSON.stringify(mockPackageContent));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    global.process = originalProcess;
  });

  describe('updatePackageVersion', () => {
    beforeEach(() => {
      vi.mocked(jsonOutput.writeVersionFile).mockClear();
      vi.mocked(jsonOutput.addPackageUpdate, { partial: true }).mockClear();
    });

    it('should update package version correctly', () => {
      const newVersion = '2.0.0';

      updatePackageVersion(mockPackagePath, newVersion);

      expect(fs.readFileSync).toHaveBeenCalledWith(mockPackagePath, 'utf8');
      expect(jsonOutput.writeVersionFile).toHaveBeenCalledWith(
        mockPackagePath,
        `${JSON.stringify({ ...mockPackageContent, version: newVersion }, null, 2)}\n`,
        false,
      );

      expect(logging.log).toHaveBeenCalledWith(
        `Updated package.json at ${mockPackagePath} to version ${newVersion}`,
        'success',
      );
      expect(jsonOutput.addPackageUpdate).toHaveBeenCalledWith('test-package', newVersion, mockPackagePath, false);
    });

    it('should not write to disk when dryRun is true', () => {
      const newVersion = '2.0.0';

      updatePackageVersion(mockPackagePath, newVersion, true);
      expect(jsonOutput.writeVersionFile).toHaveBeenCalledWith(
        mockPackagePath,
        `${JSON.stringify({ ...mockPackageContent, version: newVersion }, null, 2)}\n`,
        true,
      );

      expect(jsonOutput.addPackageUpdate).toHaveBeenCalledWith('test-package', newVersion, mockPackagePath, false);
      expect(logging.log).toHaveBeenCalledWith(
        `[DRY RUN] Would update package.json at ${mockPackagePath} to version ${newVersion}`,
        'success',
      );
    });

    it('should write to disk when dryRun is false', () => {
      const newVersion = '2.0.0';

      updatePackageVersion(mockPackagePath, newVersion, false);

      expect(jsonOutput.writeVersionFile).toHaveBeenCalledWith(
        mockPackagePath,
        `${JSON.stringify({ ...mockPackageContent, version: newVersion }, null, 2)}\n`,
        false,
      );
      expect(jsonOutput.addPackageUpdate).toHaveBeenCalledWith('test-package', newVersion, mockPackagePath, false);
    });

    it('should handle errors when updating package version', () => {
      const newVersion = '2.0.0';
      const error = new Error('Failed to write file');

      vi.mocked(jsonOutput.writeVersionFile).mockImplementation(() => {
        throw error;
      });

      expect(() => updatePackageVersion(mockPackagePath, newVersion)).toThrow(error);

      expect(logging.log).toHaveBeenCalledWith(`Failed to update package.json at ${mockPackagePath}`, 'error');
      expect(logging.log).toHaveBeenCalledWith(error.message, 'error');
    });
  });
});
