import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPubInfo, isPubspecYaml, updatePubVersion } from '../../../src/pub/pubHandler.js';
import * as jsonOutput from '../../../src/utils/jsonOutput.js';
import * as logging from '../../../src/utils/logging.js';

vi.mock('node:fs');
vi.mock('../../../src/utils/jsonOutput.js');
vi.mock('../../../src/utils/logging.js');
vi.mock('@releasekit/config', () => ({
  parsePubspec: vi.fn(),
  isPubspecYaml: vi.fn((filePath: string) => path.basename(filePath) === 'pubspec.yaml'),
}));

import { parsePubspec } from '@releasekit/config';

describe('Pub Handler', () => {
  const mockPubspecPath = path.join('test', 'fixtures', 'dart-package', 'pubspec.yaml');

  const mockPubspecContent = 'name: test_package\nversion: 1.0.0\nenvironment:\n  sdk: ">=3.0.0 <4.0.0"\n';

  const mockPubspecData = {
    name: 'test_package',
    version: '1.0.0',
    environment: { sdk: '>=3.0.0 <4.0.0' },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.existsSync, { partial: true }).mockReturnValue(true);
    vi.mocked(fs.readFileSync, { partial: true }).mockReturnValue(mockPubspecContent);
    vi.mocked(parsePubspec, { partial: true }).mockReturnValue({ ...mockPubspecData });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('isPubspecYaml', () => {
    it('should return true for pubspec.yaml files', () => {
      expect(isPubspecYaml('pubspec.yaml')).toBe(true);
      expect(isPubspecYaml('/path/to/pubspec.yaml')).toBe(true);
      expect(isPubspecYaml('project/pubspec.yaml')).toBe(true);
    });

    it('should return false for non-pubspec.yaml files', () => {
      expect(isPubspecYaml('package.json')).toBe(false);
      expect(isPubspecYaml('/path/to/Cargo.toml')).toBe(false);
      expect(isPubspecYaml('pubspec.yml')).toBe(false);
    });
  });

  describe('getPubInfo', () => {
    it('should get pub info from pubspec.yaml', () => {
      const info = getPubInfo(mockPubspecPath);

      expect(fs.existsSync).toHaveBeenCalledWith(mockPubspecPath);
      expect(parsePubspec).toHaveBeenCalledWith(mockPubspecPath);

      expect(info).toEqual({
        name: 'test_package',
        version: '1.0.0',
        path: mockPubspecPath,
        dir: path.dirname(mockPubspecPath),
      });
    });

    it('should use 0.0.0 as fallback when version is absent', () => {
      vi.mocked(parsePubspec, { partial: true }).mockReturnValue({ name: 'test_package' });

      const info = getPubInfo(mockPubspecPath);

      expect(info.version).toBe('0.0.0');
    });

    it('should throw if pubspec.yaml does not exist', () => {
      vi.mocked(fs.existsSync, { partial: true }).mockReturnValue(false);

      expect(() => getPubInfo(mockPubspecPath)).toThrow(`pubspec.yaml not found at: ${mockPubspecPath}`);

      expect(logging.log).toHaveBeenCalledWith(expect.stringContaining('pubspec.yaml not found at:'), 'error');
    });

    it('should throw if package name not found', () => {
      vi.mocked(parsePubspec, { partial: true }).mockReturnValue({});

      expect(() => getPubInfo(mockPubspecPath)).toThrow('Package name not found in:');

      expect(logging.log).toHaveBeenCalledWith(expect.stringContaining('Package name not found in:'), 'error');
    });

    it('should handle errors when reading pubspec.yaml', () => {
      const mockError = new Error('Read error');
      vi.mocked(parsePubspec, { partial: true }).mockImplementation(() => {
        throw mockError;
      });

      expect(() => getPubInfo(mockPubspecPath)).toThrow();

      expect(logging.log).toHaveBeenCalledWith(expect.stringContaining('Error reading pubspec.yaml:'), 'error');
    });
  });

  describe('updatePubVersion', () => {
    it('should update the version in pubspec.yaml', () => {
      vi.mocked(jsonOutput.addPackageUpdate, { partial: true }).mockImplementation(() => {});

      updatePubVersion(mockPubspecPath, '2.0.0');

      expect(fs.readFileSync).toHaveBeenCalledWith(mockPubspecPath, 'utf-8');
      expect(fs.writeFileSync).toHaveBeenCalledWith(mockPubspecPath, expect.stringContaining('version: 2.0.0'));
      expect(jsonOutput.addPackageUpdate).toHaveBeenCalledWith('test_package', '2.0.0', mockPubspecPath);
      expect(logging.log).toHaveBeenCalledWith(expect.stringContaining('Updated pubspec.yaml at'), 'success');
    });

    it('should preserve surrounding file content when updating version', () => {
      vi.mocked(jsonOutput.addPackageUpdate, { partial: true }).mockImplementation(() => {});

      updatePubVersion(mockPubspecPath, '2.0.0');

      const [, writtenContent] = vi.mocked(fs.writeFileSync).mock.calls[0] as [string, string];
      expect(writtenContent).toContain('name: test_package');
      expect(writtenContent).toContain('version: 2.0.0');
      expect(writtenContent).toContain('sdk: ">=3.0.0 <4.0.0"');
    });

    it('should not write to disk when dryRun is true', () => {
      vi.mocked(jsonOutput.addPackageUpdate, { partial: true }).mockImplementation(() => {});

      updatePubVersion(mockPubspecPath, '2.0.0', true);

      expect(fs.writeFileSync).not.toHaveBeenCalled();
      expect(jsonOutput.recordPendingWrite).toHaveBeenCalledWith(
        mockPubspecPath,
        expect.stringContaining('version: 2.0.0'),
      );
      expect(jsonOutput.addPackageUpdate).toHaveBeenCalledWith('test_package', '2.0.0', mockPubspecPath);
      expect(logging.log).toHaveBeenCalledWith(expect.stringContaining('[DRY RUN] Would update'), 'success');
    });

    it('should write to disk when dryRun is false', () => {
      vi.mocked(jsonOutput.addPackageUpdate, { partial: true }).mockImplementation(() => {});

      updatePubVersion(mockPubspecPath, '2.0.0', false);

      expect(fs.writeFileSync).toHaveBeenCalledWith(mockPubspecPath, expect.any(String));
      expect(jsonOutput.addPackageUpdate).toHaveBeenCalledWith('test_package', '2.0.0', mockPubspecPath);
    });

    it('should throw if package name is missing', () => {
      vi.mocked(parsePubspec, { partial: true }).mockReturnValue({});

      expect(() => updatePubVersion(mockPubspecPath, '2.0.0')).toThrow('No package name found in');
    });

    it('should throw if pubspec.yaml has no version field', () => {
      vi.mocked(fs.readFileSync, { partial: true }).mockReturnValue('name: test_package\n');
      vi.mocked(parsePubspec, { partial: true }).mockReturnValue({ name: 'test_package' });

      expect(() => updatePubVersion(mockPubspecPath, '2.0.0')).toThrow('No version field found in');
    });

    it('should throw if pubspec.yaml has a bare version key with null value', () => {
      vi.mocked(fs.readFileSync, { partial: true }).mockReturnValue('name: test_package\nversion:\n');
      vi.mocked(parsePubspec, { partial: true }).mockReturnValue({
        name: 'test_package',
        version: null as unknown as string,
      });

      expect(() => updatePubVersion(mockPubspecPath, '2.0.0')).toThrow('No version field found in');
    });

    it('should handle errors when updating pubspec.yaml', () => {
      vi.mocked(fs.readFileSync, { partial: true }).mockImplementation(() => {
        throw new Error('Read error');
      });

      expect(() => updatePubVersion(mockPubspecPath, '2.0.0')).toThrow();

      expect(logging.log).toHaveBeenCalledWith(expect.stringContaining('Failed to update pubspec.yaml at'), 'error');
    });
  });
});
