import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Config } from '../../src/types.js';

// Mock modules before importing anything
vi.mock('node:process', () => ({
  cwd: vi.fn(() => '/test/path'),
}));

vi.mock('node:fs', () => ({
  readFile: vi.fn((_path, _encoding, callback) => {
    // Default implementation
    if (callback) callback(null, '{}');
    return undefined;
  }),
}));

import * as fs from 'node:fs';
// Import after mocking
import { loadConfig } from '../../src/config.js';

describe('Config', () => {
  describe('loadConfig', () => {
    const mockConfig: Config = {
      preset: 'conventional-commits',
      packages: [],
      versionPrefix: 'v',
      tagTemplate: '${' + 'prefix}${' + 'version}',
      packageTagTemplate: '${' + 'packageName}@${' + 'prefix}${' + 'version}',
      versionStrategy: 'branchPattern' as const,
      baseBranch: 'main',
      sync: true,
      branchPattern: [],
      skip: [],
      updateInternalDependencies: 'no-internal-update' as const,
    };

    beforeEach(() => {
      vi.resetAllMocks();
    });

    it('should load config from default path when no path is provided', async () => {
      // @ts-expect-error - Mock doesn't match exact fs.readFile signature
      vi.mocked(fs.readFile, { partial: true }).mockImplementationOnce((_path, _encoding, callback) => {
        if (callback) callback(null, JSON.stringify(mockConfig));
        return undefined;
      });

      const config = await loadConfig();
      expect(config).toEqual(mockConfig);
      expect(fs.readFile).toHaveBeenCalledWith('/test/path/version.config.json', 'utf-8', expect.any(Function));
    });

    it('should load config from custom path when provided', async () => {
      // @ts-expect-error - Mock doesn't match exact fs.readFile signature
      vi.mocked(fs.readFile, { partial: true }).mockImplementationOnce((_path, _encoding, callback) => {
        if (callback) callback(null, JSON.stringify(mockConfig));
        return undefined;
      });

      const customPath = '/custom/path/config.json';
      const config = await loadConfig(customPath);

      expect(config).toEqual(mockConfig);
      expect(fs.readFile).toHaveBeenCalledWith(customPath, 'utf-8', expect.any(Function));
    });

    it('should reject with error when config file is not found', async () => {
      // Mock implementation for this test
      const fileError = new Error('File not found');
      // @ts-expect-error - Mock doesn't match exact fs.readFile signature
      vi.mocked(fs.readFile, { partial: true }).mockImplementationOnce((_path, _encoding, callback) => {
        if (callback) callback(fileError);
        return undefined;
      });

      await expect(loadConfig()).rejects.toThrow(/Could not locate the config file/);
    });

    it('should reject with error when config file is invalid JSON', async () => {
      // @ts-expect-error - Mock doesn't match exact fs.readFile signature
      vi.mocked(fs.readFile, { partial: true }).mockImplementationOnce((_path, _encoding, callback) => {
        if (callback) callback(null, '{invalid json}');
        return undefined;
      });

      await expect(loadConfig()).rejects.toThrow(/Failed to parse config file/);
    });
  });
});
