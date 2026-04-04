import * as fs from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { detectPrerelease, parsePrerelease } from '../../src/preview-detect.js';

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

const mockedFs = vi.mocked(fs);

describe('parsePrerelease', () => {
  it('should detect prerelease with identifier', () => {
    expect(parsePrerelease('0.3.0-next.4')).toEqual({ isPrerelease: true, identifier: 'next' });
  });

  it('should detect prerelease with alpha identifier', () => {
    expect(parsePrerelease('1.0.0-alpha.1')).toEqual({ isPrerelease: true, identifier: 'alpha' });
  });

  it('should detect prerelease with beta identifier', () => {
    expect(parsePrerelease('2.1.0-beta.0')).toEqual({ isPrerelease: true, identifier: 'beta' });
  });

  it('should detect prerelease with rc identifier', () => {
    expect(parsePrerelease('1.0.0-rc.1')).toEqual({ isPrerelease: true, identifier: 'rc' });
  });

  it('should return false for stable version', () => {
    expect(parsePrerelease('1.0.0')).toEqual({ isPrerelease: false });
  });

  it('should return false for undefined', () => {
    expect(parsePrerelease(undefined)).toEqual({ isPrerelease: false });
  });

  it('should return false for empty string', () => {
    expect(parsePrerelease('')).toEqual({ isPrerelease: false });
  });

  it('should detect purely numeric prerelease identifier', () => {
    expect(parsePrerelease('1.0.0-0')).toEqual({ isPrerelease: true, identifier: '0' });
  });

  it('should detect numeric prerelease with build metadata', () => {
    expect(parsePrerelease('2.0.0-20240101')).toEqual({ isPrerelease: true, identifier: '20240101' });
  });

  it('should detect alphanumeric prerelease identifier', () => {
    expect(parsePrerelease('1.0.0-rc1')).toEqual({ isPrerelease: true, identifier: 'rc1' });
  });

  it('should detect hyphenated prerelease identifier', () => {
    expect(parsePrerelease('1.0.0-my-tag.4')).toEqual({ isPrerelease: true, identifier: 'my-tag' });
  });

  it('should detect hyphenated prerelease identifier without counter', () => {
    expect(parsePrerelease('1.0.0-canary-build')).toEqual({ isPrerelease: true, identifier: 'canary-build' });
  });
});

describe('detectPrerelease', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should detect prerelease from monorepo package paths', () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(JSON.stringify({ version: '0.3.0-next.4' }));

    const result = detectPrerelease(['packages/version', 'packages/notes'], '/project');

    expect(result).toEqual({ isPrerelease: true, identifier: 'next' });
    expect(mockedFs.readFileSync).toHaveBeenCalledWith('/project/packages/version/package.json', 'utf-8');
  });

  it('should fall back to root package.json when no package paths', () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0-beta.2' }));

    const result = detectPrerelease([], '/project');

    expect(result).toEqual({ isPrerelease: true, identifier: 'beta' });
    expect(mockedFs.readFileSync).toHaveBeenCalledWith('/project/package.json', 'utf-8');
  });

  it('should return false when all versions are stable', () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0' }));

    const result = detectPrerelease(['packages/a', 'packages/b'], '/project');

    expect(result).toEqual({ isPrerelease: false });
  });

  it('should return first prerelease found across packages', () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync
      .mockReturnValueOnce(JSON.stringify({ version: '1.0.0' }))
      .mockReturnValueOnce(JSON.stringify({ version: '2.0.0-alpha.1' }));

    const result = detectPrerelease(['packages/stable', 'packages/prerelease'], '/project');

    expect(result).toEqual({ isPrerelease: true, identifier: 'alpha' });
  });

  it('should skip missing package.json files', () => {
    mockedFs.existsSync.mockReturnValueOnce(false).mockReturnValueOnce(true);
    mockedFs.readFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0-next.1' }));

    const result = detectPrerelease(['packages/missing', 'packages/exists'], '/project');

    expect(result).toEqual({ isPrerelease: true, identifier: 'next' });
  });

  it('should skip unreadable package.json files', () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync
      .mockImplementationOnce(() => {
        throw new Error('EACCES');
      })
      .mockReturnValueOnce(JSON.stringify({ version: '1.0.0' }));

    const result = detectPrerelease(['packages/bad', 'packages/good'], '/project');

    expect(result).toEqual({ isPrerelease: false });
  });
});
