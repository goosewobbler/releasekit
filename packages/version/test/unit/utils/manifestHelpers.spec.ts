import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getCargoInfo } from '../../../src/cargo/cargoHandler.js';
import * as logging from '../../../src/utils/logging.js';
import { getVersionFromManifests, throwIfNoManifestsFound } from '../../../src/utils/manifestHelpers.js';

// Mock dependencies
vi.mock('node:fs');
vi.mock('node:path');
vi.mock('../../../src/cargo/cargoHandler.js');
vi.mock('../../../src/utils/logging.js');

describe('Manifest Helpers', () => {
  const mockPackageDir = '/test/package/dir';
  const mockPackageJsonPath = '/test/package/dir/package.json';
  const mockCargoTomlPath = '/test/package/dir/Cargo.toml';

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup default path.join mock
    vi.mocked(path.join, { partial: true }).mockImplementation((...segments) => segments.join('/'));

    // Default mock: no files exist
    vi.mocked(fs.existsSync, { partial: true }).mockReturnValue(false);
    vi.mocked(fs.readFileSync, { partial: true }).mockReturnValue('');
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('getVersionFromManifests', () => {
    it('should return package.json version when it exists and has a version', () => {
      // Setup
      vi.mocked(fs.existsSync, { partial: true }).mockImplementation((filePath) => filePath === mockPackageJsonPath);
      vi.mocked(fs.readFileSync, { partial: true }).mockReturnValue(JSON.stringify({ version: '1.0.0' }));

      // Execute
      const result = getVersionFromManifests(mockPackageDir);

      // Verify
      expect(result).toEqual({
        version: '1.0.0',
        manifestFound: true,
        manifestPath: mockPackageJsonPath,
        manifestType: 'package.json',
      });
      expect(fs.existsSync).toHaveBeenCalledWith(mockPackageJsonPath);
      expect(logging.log).toHaveBeenCalledWith('Found version 1.0.0 in package.json', 'debug');
    });

    it("should fall back to Cargo.toml when package.json doesn't exist", () => {
      // Setup
      vi.mocked(fs.existsSync, { partial: true }).mockImplementation((filePath) => filePath === mockCargoTomlPath);
      vi.mocked(getCargoInfo, { partial: true }).mockReturnValue({
        name: 'test-package',
        version: '2.0.0',
        path: mockCargoTomlPath,
        dir: mockPackageDir,
        content: { package: { name: 'test-package', version: '2.0.0' } },
      });

      // Execute
      const result = getVersionFromManifests(mockPackageDir);

      // Verify
      expect(result).toEqual({
        version: '2.0.0',
        manifestFound: true,
        manifestPath: mockCargoTomlPath,
        manifestType: 'Cargo.toml',
      });
      expect(fs.existsSync).toHaveBeenCalledWith(mockPackageJsonPath);
      expect(fs.existsSync).toHaveBeenCalledWith(mockCargoTomlPath);
      expect(getCargoInfo).toHaveBeenCalledWith(mockCargoTomlPath);
      expect(logging.log).toHaveBeenCalledWith('Found version 2.0.0 in Cargo.toml', 'debug');
    });

    it('should fall back to Cargo.toml when package.json exists but has no version', () => {
      // Setup - package.json exists but has no version
      vi.mocked(fs.existsSync, { partial: true }).mockImplementation(
        (filePath) => filePath === mockPackageJsonPath || filePath === mockCargoTomlPath,
      );
      vi.mocked(fs.readFileSync, { partial: true }).mockImplementation((filePath) => {
        if (filePath === mockPackageJsonPath) {
          return JSON.stringify({ name: 'test-package' }); // No version
        }
        return '';
      });
      vi.mocked(getCargoInfo, { partial: true }).mockReturnValue({
        name: 'test-package',
        version: '2.0.0',
        path: mockCargoTomlPath,
        dir: mockPackageDir,
        content: { package: { name: 'test-package', version: '2.0.0' } },
      });

      // Execute
      const result = getVersionFromManifests(mockPackageDir);

      // Verify
      expect(result).toEqual({
        version: '2.0.0',
        manifestFound: true,
        manifestPath: mockCargoTomlPath,
        manifestType: 'Cargo.toml',
      });
      expect(logging.log).toHaveBeenCalledWith('No version field found in package.json', 'debug');
    });

    it('should handle package.json parse errors and fall back to Cargo.toml', () => {
      // Setup - package.json exists but is invalid JSON
      vi.mocked(fs.existsSync, { partial: true }).mockReturnValue(true);
      vi.mocked(fs.readFileSync, { partial: true }).mockImplementation((filePath) => {
        if (filePath === mockPackageJsonPath) {
          return 'invalid json';
        }
        return '';
      });
      vi.mocked(getCargoInfo, { partial: true }).mockReturnValue({
        name: 'test-package',
        version: '2.0.0',
        path: mockCargoTomlPath,
        dir: mockPackageDir,
        content: { package: { name: 'test-package', version: '2.0.0' } },
      });

      // Execute
      const result = getVersionFromManifests(mockPackageDir);

      // Verify
      expect(result).toEqual({
        version: '2.0.0',
        manifestFound: true,
        manifestPath: mockCargoTomlPath,
        manifestType: 'Cargo.toml',
      });
      expect(logging.log).toHaveBeenCalledWith(expect.stringContaining('Error reading package.json:'), 'warning');
    });

    it('should handle Cargo.toml errors', () => {
      // Setup - Cargo.toml exists but fails to load
      vi.mocked(fs.existsSync, { partial: true }).mockImplementation((filePath) => filePath === mockCargoTomlPath);
      const mockError = new Error('Cargo.toml error');
      vi.mocked(getCargoInfo, { partial: true }).mockImplementation(() => {
        throw mockError;
      });

      // Execute
      const result = getVersionFromManifests(mockPackageDir);

      // Verify
      expect(result).toEqual({
        version: null,
        manifestFound: false,
        manifestPath: '',
        manifestType: null,
      });
      expect(logging.log).toHaveBeenCalledWith(expect.stringContaining('Error reading Cargo.toml:'), 'warning');
    });

    it('should return null when no manifests exist', () => {
      // Setup - no files exist (default mock)

      // Execute
      const result = getVersionFromManifests(mockPackageDir);

      // Verify
      expect(result).toEqual({
        version: null,
        manifestFound: false,
        manifestPath: '',
        manifestType: null,
      });
    });

    it('should return null when both manifests exist but neither has a version', () => {
      // Setup - both files exist but neither has a version
      vi.mocked(fs.existsSync, { partial: true }).mockReturnValue(true);
      vi.mocked(fs.readFileSync, { partial: true }).mockReturnValue(JSON.stringify({ name: 'test-package' })); // No version
      vi.mocked(getCargoInfo, { partial: true }).mockReturnValue({
        name: 'test-package',
        version: '', // No version
        path: mockCargoTomlPath,
        dir: mockPackageDir,
        content: { package: { name: 'test-package' } },
      });

      // Execute
      const result = getVersionFromManifests(mockPackageDir);

      // Verify
      expect(result).toEqual({
        version: null,
        manifestFound: false,
        manifestPath: '',
        manifestType: null,
      });
      expect(logging.log).toHaveBeenCalledWith('No version field found in package.json', 'debug');
      expect(logging.log).toHaveBeenCalledWith('No version field found in Cargo.toml', 'debug');
    });
  });

  describe('throwIfNoManifestsFound', () => {
    it('should throw an error with the correct paths', () => {
      // Execute & Verify
      expect(() => throwIfNoManifestsFound(mockPackageDir)).toThrow(
        `Neither package.json nor Cargo.toml found at ${mockPackageDir}. Checked paths: ${mockPackageJsonPath}, ${mockCargoTomlPath}. Cannot determine version.`,
      );
    });
  });
});
