import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readPackageVersion } from '../../src/cli.js';

vi.mock('node:url', () => ({
  fileURLToPath: vi.fn(),
}));

vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
}));

describe('readPackageVersion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fileURLToPath).mockReturnValue('/path/to/package/src/cli.js');
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ version: '1.2.3' }));
  });

  it('should read package version from package.json', () => {
    const importMetaUrl = 'file:///path/to/package/src/cli.js';
    const version = readPackageVersion(importMetaUrl);
    expect(version).toBe('1.2.3');
    expect(fs.readFileSync).toHaveBeenCalledWith('/path/to/package/package.json', 'utf-8');
  });

  it('should return default version when package.json not found', () => {
    const importMetaUrl = 'file:///path/to/package/src/cli.js';
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      const err = new Error('ENOENT') as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      throw err;
    });
    const version = readPackageVersion(importMetaUrl);
    expect(version).toBe('0.0.0');
  });

  it('should return default version when package.json has invalid JSON', () => {
    const importMetaUrl = 'file:///path/to/package/src/cli.js';
    vi.mocked(fs.readFileSync).mockReturnValue('{ invalid json }');
    const version = readPackageVersion(importMetaUrl);
    expect(version).toBe('0.0.0');
  });

  it('should return default version when package.json lacks version field', () => {
    const importMetaUrl = 'file:///path/to/package/src/cli.js';
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ name: 'test' }));
    const version = readPackageVersion(importMetaUrl);
    expect(version).toBe('0.0.0');
  });

  it('should handle different import meta URL depths', () => {
    const importMetaUrl = 'file:///a/b/c/d/e/f/package/src/cli.js';
    vi.mocked(fileURLToPath).mockReturnValue('/a/b/c/d/e/f/package/src/cli.js');
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ version: '2.0.0' }));
    const version = readPackageVersion(importMetaUrl);
    expect(version).toBe('2.0.0');
    expect(fs.readFileSync).toHaveBeenCalledWith('/a/b/c/d/e/f/package/package.json', 'utf-8');
  });
});
