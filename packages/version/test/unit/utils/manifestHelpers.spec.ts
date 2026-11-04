import fs from 'node:fs';
import path from 'node:path';
import { parsePubspec } from '@releasekit/config';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getCargoInfo } from '../../../src/cargo/cargoHandler.js';
import * as logging from '../../../src/utils/logging.js';
import { getVersionFromManifests, throwIfNoManifestsFound } from '../../../src/utils/manifestHelpers.js';

vi.mock('node:fs');
vi.mock('node:path');
vi.mock('@releasekit/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@releasekit/config')>();
  return { ...actual, parsePubspec: vi.fn() };
});
vi.mock('../../../src/cargo/cargoHandler.js');
vi.mock('../../../src/utils/logging.js');

describe('Manifest Helpers', () => {
  const mockPackageDir = '/test/package/dir';
  const mockPackageJsonPath = '/test/package/dir/package.json';
  const mockCargoTomlPath = '/test/package/dir/Cargo.toml';
  const mockPubspecPath = '/test/package/dir/pubspec.yaml';

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(path.join, { partial: true }).mockImplementation((...segments) => segments.join('/'));

    vi.mocked(fs.existsSync, { partial: true }).mockReturnValue(false);
    vi.mocked(fs.readFileSync, { partial: true }).mockReturnValue('');
    vi.mocked(parsePubspec).mockReturnValue({});
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('getVersionFromManifests', () => {
    it('should return package.json version when it exists and has a version', () => {
      vi.mocked(fs.existsSync, { partial: true }).mockImplementation((filePath) => filePath === mockPackageJsonPath);
      vi.mocked(fs.readFileSync, { partial: true }).mockReturnValue(JSON.stringify({ version: '1.0.0' }));

      const result = getVersionFromManifests(mockPackageDir);

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
      vi.mocked(fs.existsSync, { partial: true }).mockImplementation((filePath) => filePath === mockCargoTomlPath);
      vi.mocked(getCargoInfo, { partial: true }).mockReturnValue({
        name: 'test-package',
        version: '2.0.0',
        path: mockCargoTomlPath,
        dir: mockPackageDir,
        content: { package: { name: 'test-package', version: '2.0.0' } },
      });

      const result = getVersionFromManifests(mockPackageDir);

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
      vi.mocked(fs.existsSync, { partial: true }).mockImplementation(
        (filePath) => filePath === mockPackageJsonPath || filePath === mockCargoTomlPath,
      );
      vi.mocked(fs.readFileSync, { partial: true }).mockImplementation((filePath) => {
        if (filePath === mockPackageJsonPath) {
          return JSON.stringify({ name: 'test-package' });
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

      const result = getVersionFromManifests(mockPackageDir);

      expect(result).toEqual({
        version: '2.0.0',
        manifestFound: true,
        manifestPath: mockCargoTomlPath,
        manifestType: 'Cargo.toml',
      });
      expect(logging.log).toHaveBeenCalledWith('No version field found in package.json', 'debug');
    });

    it('should handle package.json parse errors and fall back to Cargo.toml', () => {
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

      const result = getVersionFromManifests(mockPackageDir);

      expect(result).toEqual({
        version: '2.0.0',
        manifestFound: true,
        manifestPath: mockCargoTomlPath,
        manifestType: 'Cargo.toml',
      });
      expect(logging.log).toHaveBeenCalledWith(expect.stringContaining('Error reading package.json:'), 'warning');
    });

    it('should handle Cargo.toml errors', () => {
      vi.mocked(fs.existsSync, { partial: true }).mockImplementation((filePath) => filePath === mockCargoTomlPath);
      const mockError = new Error('Cargo.toml error');
      vi.mocked(getCargoInfo, { partial: true }).mockImplementation(() => {
        throw mockError;
      });

      const result = getVersionFromManifests(mockPackageDir);

      expect(result).toEqual({
        version: null,
        manifestFound: false,
        manifestPath: '',
        manifestType: null,
      });
      expect(logging.log).toHaveBeenCalledWith(expect.stringContaining('Error reading Cargo.toml:'), 'warning');
    });

    it('should fall back to pubspec.yaml when package.json and Cargo.toml are absent', () => {
      vi.mocked(fs.existsSync, { partial: true }).mockImplementation((filePath) => filePath === mockPubspecPath);
      vi.mocked(parsePubspec).mockReturnValue({ name: 'test_package', version: '3.1.0' });

      const result = getVersionFromManifests(mockPackageDir);

      expect(result).toEqual({
        version: '3.1.0',
        manifestFound: true,
        manifestPath: mockPubspecPath,
        manifestType: 'pubspec.yaml',
      });
      expect(parsePubspec).toHaveBeenCalledWith(mockPubspecPath);
      expect(logging.log).toHaveBeenCalledWith('Found version 3.1.0 in pubspec.yaml', 'debug');
    });

    it('should return null when no manifests exist', () => {
      const result = getVersionFromManifests(mockPackageDir);

      expect(result).toEqual({
        version: null,
        manifestFound: false,
        manifestPath: '',
        manifestType: null,
      });
    });

    it('should return null when both manifests exist but neither has a version', () => {
      vi.mocked(fs.existsSync, { partial: true }).mockReturnValue(true);
      vi.mocked(fs.readFileSync, { partial: true }).mockReturnValue(JSON.stringify({ name: 'test-package' }));
      vi.mocked(getCargoInfo, { partial: true }).mockReturnValue({
        name: 'test-package',
        version: '',
        path: mockCargoTomlPath,
        dir: mockPackageDir,
        content: { package: { name: 'test-package' } },
      });

      const result = getVersionFromManifests(mockPackageDir);

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
      expect(() => throwIfNoManifestsFound(mockPackageDir)).toThrow(
        `Neither package.json, Cargo.toml, nor pubspec.yaml found at ${mockPackageDir}. Checked paths: ${mockPackageJsonPath}, ${mockCargoTomlPath}, ${mockPubspecPath}. Cannot determine version.`,
      );
    });
  });
});
