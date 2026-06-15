import * as version from '@releasekit/version';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reconstructChangelogs, versionFromTag } from '../../../src/backfill/reconstruct.js';

vi.mock('@releasekit/version', () => ({
  listPackageTags: vi.fn(),
  // Echo the revision range back as an entry so tests can assert the pairing.
  extractChangelogEntriesFromCommits: vi.fn((_pkgPath: string, range: string) => [
    { type: 'feat', description: range },
  ]),
}));

describe('reconstructChangelogs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(version.extractChangelogEntriesFromCommits).mockImplementation((_pkgPath: string, range: string) => [
      { type: 'feat', description: range },
    ]);
  });

  it('should reconstruct one changelog per tag, paired with its predecessor and sorted by version', async () => {
    // listPackageTags returns newest-first; reconstruct must re-sort ascending and pair each tag.
    vi.mocked(version.listPackageTags).mockResolvedValue(['pkg@v1.2.0', 'pkg@v1.0.0', 'pkg@v1.1.0']);

    const result = await reconstructChangelogs({ packageName: 'pkg', pkgPath: '/p', packageSpecificTags: true });

    expect(result.map((c) => c.version)).toEqual(['1.0.0', '1.1.0', '1.2.0']);
    expect(result[0]).toMatchObject({ previousVersion: null, revisionRange: 'pkg@v1.0.0' });
    expect(result[1]).toMatchObject({ previousVersion: '1.0.0', revisionRange: 'pkg@v1.0.0..pkg@v1.1.0' });
    expect(result[2]).toMatchObject({ previousVersion: '1.1.0', revisionRange: 'pkg@v1.1.0..pkg@v1.2.0' });
    // Entries are extracted from each pair's range.
    expect(result[2]?.entries[0]?.description).toBe('pkg@v1.1.0..pkg@v1.2.0');
  });

  it('should honor inclusive from/to version bounds while still pairing with the real predecessor', async () => {
    vi.mocked(version.listPackageTags).mockResolvedValue(['pkg@v1.0.0', 'pkg@v1.1.0', 'pkg@v2.0.0']);

    const result = await reconstructChangelogs({ packageName: 'pkg', pkgPath: '/p', from: '1.1.0', to: '1.1.0' });

    expect(result.map((c) => c.version)).toEqual(['1.1.0']);
    expect(result[0]?.previousVersion).toBe('1.0.0');
    expect(result[0]?.revisionRange).toBe('pkg@v1.0.0..pkg@v1.1.0');
  });

  it('should skip tags without a valid semver', async () => {
    vi.mocked(version.listPackageTags).mockResolvedValue(['pkg@v1.0.0', 'pkg@latest', 'nightly']);

    const result = await reconstructChangelogs({ packageName: 'pkg', pkgPath: '/p' });

    expect(result.map((c) => c.version)).toEqual(['1.0.0']);
  });

  it('should return an empty list when there are no matching tags', async () => {
    vi.mocked(version.listPackageTags).mockResolvedValue([]);

    const result = await reconstructChangelogs({ packageName: 'pkg', pkgPath: '/p' });

    expect(result).toEqual([]);
  });
});

describe('versionFromTag', () => {
  it('should extract the semver from common tag shapes', () => {
    expect(versionFromTag('pkg@v1.2.0')).toBe('1.2.0');
    expect(versionFromTag('v1.2.0-next.0')).toBe('1.2.0-next.0');
    expect(versionFromTag('scope-pkg-v2.0.0')).toBe('2.0.0');
    expect(versionFromTag('1.0.0')).toBe('1.0.0');
  });

  it('should return null for tags without a semver', () => {
    expect(versionFromTag('latest')).toBeNull();
    expect(versionFromTag('release-candidate')).toBeNull();
  });
});
