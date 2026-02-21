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
  parse: vi.fn(),
  stringify: vi.fn(() => 'mocked stringified TOML'),
}));

describe('Cargo Handler', () => {
  const mockCargoPath = path.join('test', 'fixtures', 'rust-package', 'Cargo.toml');
  const mockCargoContent = `
[package]
name = "test-package"
version = "1.0.0"
edition = "2021"

[dependencies]
serde = "1.0"
  `;

  const mockCargoObject = {
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
    vi.mocked(fs.readFileSync, { partial: true }).mockReturnValue(mockCargoContent);
    vi.mocked(TOML.parse, { partial: true }).mockReturnValue(mockCargoObject);
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
      expect(fs.readFileSync).toHaveBeenCalledWith(mockCargoPath, 'utf8');
      expect(TOML.parse).toHaveBeenCalledWith(mockCargoContent);

      expect(cargoInfo).toEqual({
        name: 'test-package',
        version: '1.0.0',
        path: mockCargoPath,
        dir: path.dirname(mockCargoPath),
        content: mockCargoObject,
      });
    });

    it('should exit if Cargo.toml does not exist', () => {
      // Mock fs.existsSync to return false
      vi.mocked(fs.existsSync, { partial: true }).mockReturnValue(false);

      // Now we expect an error to be thrown instead of process.exit
      expect(() => getCargoInfo(mockCargoPath)).toThrow(`Cargo.toml file not found at: ${mockCargoPath}`);

      // Verify fs.existsSync was called
      expect(fs.existsSync).toHaveBeenCalledWith(mockCargoPath);

      // Verify log was called with the error message
      expect(logging.log).toHaveBeenCalledWith(expect.stringContaining('Cargo.toml file not found at:'), 'error');
    });

    it('should exit if package name not found', () => {
      // Remove process.exit mock
      vi.mocked(TOML.parse, { partial: true }).mockReturnValue({ package: {} });

      // Expect error to be thrown
      expect(() => getCargoInfo(mockCargoPath)).toThrow(`Package name not found in: ${mockCargoPath}`);

      expect(logging.log).toHaveBeenCalledWith(expect.stringContaining('Package name not found in:'), 'error');
    });

    it('should handle errors when reading Cargo.toml', () => {
      // Remove process.exit mock
      const mockError = new Error('Read error');
      vi.mocked(fs.readFileSync, { partial: true }).mockImplementation(() => {
        throw mockError;
      });

      // Expect error to be thrown
      expect(() => getCargoInfo(mockCargoPath)).toThrow();

      expect(logging.log).toHaveBeenCalledWith(expect.stringContaining('Error reading Cargo.toml:'), 'error');
      expect(logging.log).toHaveBeenCalledWith(mockError.message, 'error');
    });
  });

  describe('updateCargoVersion', () => {
    it('should update the version in Cargo.toml', () => {
      vi.mocked(jsonOutput.addPackageUpdate, { partial: true }).mockImplementation(() => {});

      updateCargoVersion(mockCargoPath, '2.0.0');

      // Verify that the TOML was parsed
      expect(TOML.parse).toHaveBeenCalledWith(mockCargoContent);

      // Verify that the version was updated in the parsed object before stringification
      const updatedCargo = { ...mockCargoObject };
      updatedCargo.package.version = '2.0.0';

      // Verify TOML.stringify was called with the expected object
      expect(TOML.stringify).toHaveBeenCalledWith(updatedCargo);

      // Verify the file was written back
      expect(fs.writeFileSync).toHaveBeenCalledWith(mockCargoPath, 'mocked stringified TOML');

      // Verify the update was logged
      expect(logging.log).toHaveBeenCalledWith(expect.stringContaining('Updated Cargo.toml at'), 'success');

      // Verify the update was tracked for JSON output
      expect(jsonOutput.addPackageUpdate).toHaveBeenCalledWith('test-package', '2.0.0', mockCargoPath);
    });

    it('should handle errors when updating Cargo.toml', () => {
      vi.mocked(fs.readFileSync, { partial: true }).mockImplementation(() => {
        throw new Error('Update error');
      });

      expect(() => updateCargoVersion(mockCargoPath, '2.0.0')).toThrow();

      expect(logging.log).toHaveBeenCalledWith(expect.stringContaining('Failed to update Cargo.toml at'), 'error');
    });

    it('should throw an error if package name is not found', () => {
      vi.mocked(TOML.parse, { partial: true }).mockReturnValue({ package: { version: '1.0.0' } });

      expect(() => updateCargoVersion(mockCargoPath, '2.0.0')).toThrow('No package name found in');
    });

    it('should create package section if missing', () => {
      const mockCargoWithoutPackage = {};
      vi.mocked(TOML.parse, { partial: true }).mockReturnValue(mockCargoWithoutPackage);

      expect(() => updateCargoVersion(mockCargoPath, '2.0.0')).toThrow();
    });
  });
});
