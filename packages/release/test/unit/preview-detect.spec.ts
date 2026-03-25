import * as fs from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { detectPrerelease, parsePrerelease } from '../../src/preview-detect.js';

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

const mockedFs = vi.mocked(fs);

describe('parsePrerelease', () => {
  it('detects prerelease with identifier', () => {
    expect(parsePrerelease('0.3.0-next.4')).toEqual({ isPrerelease: true, identifier: 'next' });
  });

  it('detects prerelease with alpha identifier', () => {
    expect(parsePrerelease('1.0.0-alpha.1')).toEqual({ isPrerelease: true, identifier: 'alpha' });
  });

  it('detects prerelease with beta identifier', () => {
    expect(parsePrerelease('2.1.0-beta.0')).toEqual({ isPrerelease: true, identifier: 'beta' });
  });

  it('detects prerelease with rc identifier', () => {
    expect(parsePrerelease('1.0.0-rc.1')).toEqual({ isPrerelease: true, identifier: 'rc' });
  });

  it('returns false for stable version', () => {
    expect(parsePrerelease('1.0.0')).toEqual({ isPrerelease: false });
  });

  it('returns false for undefined', () => {
    expect(parsePrerelease(undefined)).toEqual({ isPrerelease: false });
  });

  it('returns false for empty string', () => {
    expect(parsePrerelease('')).toEqual({ isPrerelease: false });
  });

  it('detects purely numeric prerelease identifier', () => {
    expect(parsePrerelease('1.0.0-0')).toEqual({ isPrerelease: true, identifier: '0' });
  });

  it('detects numeric prerelease with build metadata', () => {
    expect(parsePrerelease('2.0.0-20240101')).toEqual({ isPrerelease: true, identifier: '20240101' });
  });

  it('detects alphanumeric prerelease identifier', () => {
    expect(parsePrerelease('1.0.0-rc1')).toEqual({ isPrerelease: true, identifier: 'rc1' });
  });

  it('detects hyphenated prerelease identifier', () => {
    expect(parsePrerelease('1.0.0-my-tag.4')).toEqual({ isPrerelease: true, identifier: 'my-tag' });
  });

  it('detects hyphenated prerelease identifier without counter', () => {
    expect(parsePrerelease('1.0.0-canary-build')).toEqual({ isPrerelease: true, identifier: 'canary-build' });
  });
});

describe('detectPrerelease', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('detects prerelease from monorepo package paths', () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(JSON.stringify({ version: '0.3.0-next.4' }));

    const result = detectPrerelease(['packages/version', 'packages/notes'], '/project');

    expect(result).toEqual({ isPrerelease: true, identifier: 'next' });
    expect(mockedFs.readFileSync).toHaveBeenCalledWith('/project/packages/version/package.json', 'utf-8');
  });

  it('falls back to root package.json when no package paths', () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0-beta.2' }));

    const result = detectPrerelease([], '/project');

    expect(result).toEqual({ isPrerelease: true, identifier: 'beta' });
    expect(mockedFs.readFileSync).toHaveBeenCalledWith('/project/package.json', 'utf-8');
  });

  it('returns false when all versions are stable', () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0' }));

    const result = detectPrerelease(['packages/a', 'packages/b'], '/project');

    expect(result).toEqual({ isPrerelease: false });
  });

  it('returns first prerelease found across packages', () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync
      .mockReturnValueOnce(JSON.stringify({ version: '1.0.0' }))
      .mockReturnValueOnce(JSON.stringify({ version: '2.0.0-alpha.1' }));

    const result = detectPrerelease(['packages/stable', 'packages/prerelease'], '/project');

    expect(result).toEqual({ isPrerelease: true, identifier: 'alpha' });
  });

  it('skips missing package.json files', () => {
    mockedFs.existsSync.mockReturnValueOnce(false).mockReturnValueOnce(true);
    mockedFs.readFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0-next.1' }));

    const result = detectPrerelease(['packages/missing', 'packages/exists'], '/project');

    expect(result).toEqual({ isPrerelease: true, identifier: 'next' });
  });

  it('skips unreadable package.json files', () => {
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
