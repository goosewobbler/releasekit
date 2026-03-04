import fs from 'node:fs';
import path from 'node:path';
import * as TOML from 'smol-toml';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getCargoInfo, isCargoToml, updateCargoVersion } from '../../../src/cargo/cargoHandler.js';
import * as jsonOutput from '../../../src/utils/jsonOutput.js';
import * as logging from '../../../src/utils/logging.js';

// Mock dependencies
vi.mock('node:fs');
vi.mock('../../../src/utils/jsonOutput.js');
vi.mock('../../../src/utils/logging.js');
vi.mock('smol-toml', () => ({
  stringify: vi.fn(() => 'mocked stringified TOML'),
}));
vi.mock('@releasekit/config', () => ({
  parseCargoToml: vi.fn(),
  isCargoToml: vi.fn((filePath: string) => path.basename(filePath) === 'Cargo.toml'),
}));

// Import mocked modules
import { parseCargoToml } from '@releasekit/config';

describe('Cargo Handler', () => {
  const mockCargoPath = path.join('test', 'fixtures', 'rust-package', 'Cargo.toml');

  const mockCargoTemplate = {
    package: {
      name: 'test-package',
      version: '1.0.0',
      edition: '2021',
    },
    dependencies: {
      serde: '1.0',
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.existsSync, { partial: true }).mockReturnValue(true);
    // Return a fresh deep copy each test to avoid mutation side effects
    vi.mocked(parseCargoToml, { partial: true }).mockReturnValue({
      ...mockCargoTemplate,
      package: { ...mockCargoTemplate.package },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('isCargoToml', () => {
    it('should return true for Cargo.toml files', () => {
      expect(isCargoToml('Cargo.toml')).toBe(true);
      expect(isCargoToml('/path/to/Cargo.toml')).toBe(true);
      expect(isCargoToml('project/Cargo.toml')).toBe(true);
    });

    it('should return false for non-Cargo.toml files', () => {
      expect(isCargoToml('package.json')).toBe(false);
      expect(isCargoToml('/path/to/file.txt')).toBe(false);
      expect(isCargoToml('cargo.toml')).toBe(false); // Lowercase
    });
  });

  describe('getCargoInfo', () => {
    it('should get cargo info from Cargo.toml', () => {
      const cargoInfo = getCargoInfo(mockCargoPath);

      expect(fs.existsSync).toHaveBeenCalledWith(mockCargoPath);
      expect(parseCargoToml).toHaveBeenCalledWith(mockCargoPath);

      expect(cargoInfo).toEqual({
        name: 'test-package',
        version: '1.0.0',
        path: mockCargoPath,
        dir: path.dirname(mockCargoPath),
        content: mockCargoTemplate,
      });
    });

    it('should exit if Cargo.toml does not exist', () => {
      vi.mocked(fs.existsSync, { partial: true }).mockReturnValue(false);

      expect(() => getCargoInfo(mockCargoPath)).toThrow(`Cargo.toml file not found at: ${mockCargoPath}`);

      expect(fs.existsSync).toHaveBeenCalledWith(mockCargoPath);
      expect(logging.log).toHaveBeenCalledWith(expect.stringContaining('Cargo.toml file not found at:'), 'error');
    });

    it('should exit if package name not found', () => {
      vi.mocked(parseCargoToml, { partial: true }).mockReturnValue({ package: {} });

      expect(() => getCargoInfo(mockCargoPath)).toThrow(`Package name not found in: ${mockCargoPath}`);

      expect(logging.log).toHaveBeenCalledWith(expect.stringContaining('Package name not found in:'), 'error');
    });

    it('should handle errors when reading Cargo.toml', () => {
      const mockError = new Error('Read error');
      vi.mocked(parseCargoToml, { partial: true }).mockImplementation(() => {
        throw mockError;
      });

      expect(() => getCargoInfo(mockCargoPath)).toThrow();

      expect(logging.log).toHaveBeenCalledWith(expect.stringContaining('Error reading Cargo.toml:'), 'error');
      expect(logging.log).toHaveBeenCalledWith(mockError.message, 'error');
    });
  });

  describe('updateCargoVersion', () => {
    it('should update the version in Cargo.toml', () => {
      vi.mocked(jsonOutput.addPackageUpdate, { partial: true }).mockImplementation(() => {});

      updateCargoVersion(mockCargoPath, '2.0.0');

      // Verify that parseCargoToml was called
      expect(parseCargoToml).toHaveBeenCalledWith(mockCargoPath);

      // Verify TOML.stringify was called with the updated version
      expect(TOML.stringify).toHaveBeenCalledWith(
        expect.objectContaining({
          package: expect.objectContaining({ name: 'test-package', version: '2.0.0' }),
        }),
      );

      // Verify the file was written back
      expect(fs.writeFileSync).toHaveBeenCalledWith(mockCargoPath, 'mocked stringified TOML');

      // Verify the update was logged
      expect(logging.log).toHaveBeenCalledWith(expect.stringContaining('Updated Cargo.toml at'), 'success');

      // Verify the update was tracked for JSON output
      expect(jsonOutput.addPackageUpdate).toHaveBeenCalledWith('test-package', '2.0.0', mockCargoPath);
    });

    it('should not write to disk when dryRun is true', () => {
      vi.mocked(jsonOutput.addPackageUpdate, { partial: true }).mockImplementation(() => {});

      updateCargoVersion(mockCargoPath, '2.0.0', true);

      // Should NOT write to the file
      expect(fs.writeFileSync).not.toHaveBeenCalled();
      // Should NOT even call TOML.stringify since we're not writing
      expect(TOML.stringify).not.toHaveBeenCalled();

      // Should still track the update and log
      expect(jsonOutput.addPackageUpdate).toHaveBeenCalledWith('test-package', '2.0.0', mockCargoPath);
      expect(logging.log).toHaveBeenCalledWith(expect.stringContaining('[DRY RUN] Would update'), 'success');
    });

    it('should write to disk when dryRun is false', () => {
      vi.mocked(jsonOutput.addPackageUpdate, { partial: true }).mockImplementation(() => {});

      updateCargoVersion(mockCargoPath, '2.0.0', false);

      expect(TOML.stringify).toHaveBeenCalled();
      expect(fs.writeFileSync).toHaveBeenCalledWith(mockCargoPath, 'mocked stringified TOML');
      expect(jsonOutput.addPackageUpdate).toHaveBeenCalledWith('test-package', '2.0.0', mockCargoPath);
    });

    it('should handle errors when updating Cargo.toml', () => {
      vi.mocked(parseCargoToml, { partial: true }).mockImplementation(() => {
        throw new Error('Update error');
      });

      expect(() => updateCargoVersion(mockCargoPath, '2.0.0')).toThrow();

      expect(logging.log).toHaveBeenCalledWith(expect.stringContaining('Failed to update Cargo.toml at'), 'error');
    });

    it('should throw an error if package name is not found', () => {
      vi.mocked(parseCargoToml, { partial: true }).mockReturnValue({ package: { version: '1.0.0' } });

      expect(() => updateCargoVersion(mockCargoPath, '2.0.0')).toThrow('No package name found in');
    });

    it('should create package section if missing', () => {
      vi.mocked(parseCargoToml, { partial: true }).mockReturnValue({});

      expect(() => updateCargoVersion(mockCargoPath, '2.0.0')).toThrow();
    });
  });
});
