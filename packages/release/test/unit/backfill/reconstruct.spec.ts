import { execFileSync } from 'node:child_process';
import * as version from '@releasekit/version';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reconstructChangelogs, versionFromTag } from '../../../src/backfill/reconstruct.js';

vi.mock('@releasekit/version', () => ({
  listPackageTags: vi.fn(),
  listGlobalTags: vi.fn(),
  // Echo the revision range back as an entry so tests can assert the pairing.
  extractChangelogEntriesFromCommits: vi.fn((_pkgPath: string, range: string) => [
    { type: 'feat', description: range },
  ]),
}));

// reconstruct shells out to `git log` for each tag's date; mock it so the tests don't touch git.
vi.mock('node:child_process', () => ({ execFileSync: vi.fn(() => '2024-01-15\n') }));

describe('reconstructChangelogs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(version.extractChangelogEntriesFromCommits).mockImplementation((_pkgPath: string, range: string) => [
      { type: 'feat', description: range },
    ]);
    vi.mocked(version.listGlobalTags).mockResolvedValue([]);
    vi.mocked(execFileSync).mockReturnValue('2024-01-15\n');
  });

  it("should stamp each version with the tag's commit date, trimmed", async () => {
    vi.mocked(execFileSync).mockReturnValue('2023-09-30\n');
    vi.mocked(version.listPackageTags).mockResolvedValue(['pkg@v1.0.0']);

    const result = await reconstructChangelogs({ packageName: 'pkg', pkgPath: '/p', packageSpecificTags: true });

    expect(result[0]?.date).toBe('2023-09-30');
  });

  it('should leave the date undefined when git cannot resolve the tag', async () => {
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error('fatal: ambiguous argument');
    });
    vi.mocked(version.listPackageTags).mockResolvedValue(['pkg@v1.0.0']);

    const result = await reconstructChangelogs({ packageName: 'pkg', pkgPath: '/p', packageSpecificTags: true });

    expect(result[0]?.date).toBeUndefined();
  });

  it('should reconstruct one changelog per tag, paired with its predecessor and sorted by version', async () => {
    // listPackageTags returns newest-first; reconstruct must re-sort ascending and pair each tag.
    vi.mocked(version.listPackageTags).mockResolvedValue(['pkg@v1.2.0', 'pkg@v1.0.0', 'pkg@v1.1.0']);

    const result = await reconstructChangelogs({ packageName: 'pkg', pkgPath: '/p', packageSpecificTags: true });

    expect(result.map((r) => r.changelog.version)).toEqual(['1.0.0', '1.1.0', '1.2.0']);
    // Each entry carries the source tag alongside its rebuilt changelog.
    expect(result.map((r) => r.tag)).toEqual(['pkg@v1.0.0', 'pkg@v1.1.0', 'pkg@v1.2.0']);
    expect(result[0]?.changelog).toMatchObject({ previousVersion: null, revisionRange: 'pkg@v1.0.0' });
    expect(result[1]?.changelog).toMatchObject({ previousVersion: '1.0.0', revisionRange: 'pkg@v1.0.0..pkg@v1.1.0' });
    expect(result[2]?.changelog).toMatchObject({ previousVersion: '1.1.0', revisionRange: 'pkg@v1.1.0..pkg@v1.2.0' });
    // Entries are extracted from each pair's range.
    expect(result[2]?.changelog.entries[0]?.description).toBe('pkg@v1.1.0..pkg@v1.2.0');
  });

  it('should honor inclusive from/to version bounds while still pairing with the real predecessor', async () => {
    vi.mocked(version.listPackageTags).mockResolvedValue(['pkg@v1.0.0', 'pkg@v1.1.0', 'pkg@v2.0.0']);

    const result = await reconstructChangelogs({
      packageName: 'pkg',
      pkgPath: '/p',
      packageSpecificTags: true,
      from: '1.1.0',
      to: '1.1.0',
    });

    expect(result.map((r) => r.changelog.version)).toEqual(['1.1.0']);
    expect(result[0]?.changelog.previousVersion).toBe('1.0.0');
    expect(result[0]?.changelog.revisionRange).toBe('pkg@v1.0.0..pkg@v1.1.0');
  });

  it('should skip tags without a valid semver', async () => {
    vi.mocked(version.listPackageTags).mockResolvedValue(['pkg@v1.0.0', 'pkg@latest', 'nightly']);

    const result = await reconstructChangelogs({ packageName: 'pkg', pkgPath: '/p', packageSpecificTags: true });

    expect(result.map((r) => r.changelog.version)).toEqual(['1.0.0']);
  });

  it('should use the global tag series when packageSpecificTags is off', async () => {
    // No package name in the tags — sync/single repos share one `v*` series. listPackageTags is not
    // consulted; pairing and per-package commit scoping happen exactly as in the package-specific path.
    vi.mocked(version.listGlobalTags).mockResolvedValue(['v1.1.0', 'v1.0.0']);

    const result = await reconstructChangelogs({ packageName: 'pkg', pkgPath: '/p', versionPrefix: 'v' });

    expect(version.listGlobalTags).toHaveBeenCalledWith('v');
    expect(version.listPackageTags).not.toHaveBeenCalled();
    expect(result.map((r) => r.tag)).toEqual(['v1.0.0', 'v1.1.0']);
    expect(result.map((r) => r.changelog.version)).toEqual(['1.0.0', '1.1.0']);
    expect(result[1]?.changelog.revisionRange).toBe('v1.0.0..v1.1.0');
  });

  it('should return an empty list when there are no matching tags', async () => {
    vi.mocked(version.listGlobalTags).mockResolvedValue([]);

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
