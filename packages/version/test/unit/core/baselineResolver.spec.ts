import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BaselineResolver, type BaselineResolverOptions } from '../../../src/core/baselineResolver.js';
import { StrictReachableError } from '../../../src/errors/strictReachableError.js';
import {
  getLatestStableTag,
  getLatestStableTagForPackage,
  getNearestReachableTag,
} from '../../../src/git/tagsAndBranches.js';
import { verifyTag } from '../../../src/git/tagVerification.js';

// Mock only the git seams. displayTag (formatting) and isStableVersion/isStableTag (versionUtils)
// are pure and left real so graduation + display logic is genuinely exercised.
vi.mock('../../../src/git/tagVerification.js');
vi.mock('../../../src/git/tagsAndBranches.js');
vi.mock('../../../src/utils/logging.js');

const reachable = { exists: true, reachable: true } as const;
const unreachable = { exists: true, reachable: false, error: 'exists but is not an ancestor of HEAD' } as const;

function makeOpts(overrides: Partial<BaselineResolverOptions> = {}): BaselineResolverOptions {
  return { versionPrefix: 'v', packageSpecificTags: false, strictReachable: false, ...overrides };
}

function makeInput(overrides: Partial<Parameters<BaselineResolver['resolve']>[0]> = {}) {
  return {
    pkgDir: '/repo',
    latestTag: 'v1.0.0',
    hasRealTag: true,
    usedPackageSpecificTag: false,
    nextVersion: '1.1.0',
    graduationName: 'pkg',
    baselineTagPrefix: undefined,
    formattedPrefix: 'v',
    ...overrides,
  };
}

describe('BaselineResolver.resolve', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should bound the range by a reachable tag and surface it as previousVersion', async () => {
    vi.mocked(verifyTag).mockResolvedValue(reachable);
    const result = await new BaselineResolver(makeOpts()).resolve(makeInput());
    expect(result.revisionRange).toBe('v1.0.0..HEAD');
    expect(result.previousVersion).toBe('v1.0.0');
    expect(result.baselineUnreachable).toBe(false);
  });

  it('should bound by the nearest reachable tag (not full history) when the tag is unreachable', async () => {
    vi.mocked(verifyTag).mockResolvedValue(unreachable);
    vi.mocked(getNearestReachableTag).mockResolvedValue('v0.9.0');
    const result = await new BaselineResolver(makeOpts()).resolve(makeInput());
    // The own (unreachable) baseline floods full history; #370 floors it by the nearest reachable tag.
    expect(result.revisionRange).toBe('v0.9.0..HEAD');
    // …but previousVersion stays null: we diffed the nearest tag, not the package's own baseline.
    expect(result.previousVersion).toBeNull();
    expect(result.baselineUnreachable).toBe(true);
  });

  it('should fall back to full history only when no reachable tag exists at all (fresh repo)', async () => {
    vi.mocked(verifyTag).mockResolvedValue(unreachable);
    vi.mocked(getNearestReachableTag).mockResolvedValue('');
    const result = await new BaselineResolver(makeOpts()).resolve(makeInput());
    expect(result.revisionRange).toBe('HEAD');
    expect(result.previousVersion).toBeNull();
    expect(result.baselineUnreachable).toBe(true);
  });

  it('should throw a StrictReachableError on an unreachable baseline when strictReachable is set', async () => {
    vi.mocked(verifyTag).mockResolvedValue(unreachable);
    // The type — not just the message — is the contract (#372): the per-package changelog catch in
    // each strategy distinguishes this from a genuine extraction error by `instanceof` and rethrows
    // it so the run aborts, instead of degrading to a minimal changelog entry.
    const promise = new BaselineResolver(makeOpts({ strictReachable: true })).resolve(makeInput());
    await expect(promise).rejects.toBeInstanceOf(StrictReachableError);
    await expect(promise).rejects.toThrow(/not reachable/);
  });

  it('should not throw under strictReachable when baseRef is set (baseRef takes precedence)', async () => {
    vi.mocked(verifyTag).mockResolvedValue(unreachable);
    const result = await new BaselineResolver(makeOpts({ strictReachable: true, baseRef: 'abc123' })).resolve(
      makeInput(),
    );
    expect(result.revisionRange).toBe('HEAD');
    expect(result.baselineUnreachable).toBe(true);
    // baseRef short-circuits before the nearest-reachable floor in every variant — assert it here too.
    expect(getNearestReachableTag).not.toHaveBeenCalled();
  });

  it('should keep the full-history fallback for an unreachable baseRef, not the nearest-reachable floor', async () => {
    // baseRef scopes the run to a PR's commits — a different intent from the tag floor, so an
    // unreachable baseRef stays at HEAD rather than borrowing the nearest tag (mirrors sharedFloor).
    vi.mocked(verifyTag).mockResolvedValue(unreachable);
    const result = await new BaselineResolver(makeOpts({ baseRef: 'abc123' })).resolve(makeInput());
    expect(result.revisionRange).toBe('HEAD');
    expect(result.baselineUnreachable).toBe(true);
    expect(getNearestReachableTag).not.toHaveBeenCalled();
  });

  it('should use baseRef as the floor when set, overriding the tag', async () => {
    vi.mocked(verifyTag).mockResolvedValue(reachable);
    const result = await new BaselineResolver(makeOpts({ baseRef: 'abc123' })).resolve(makeInput());
    expect(verifyTag).toHaveBeenCalledWith('abc123', '/repo');
    expect(result.revisionRange).toBe('abc123..HEAD');
  });

  it('should bound an untagged package by the nearest reachable tag, not full history', async () => {
    // The standing-PR-body flood: a new package in a tagged repo would otherwise summarize ALL
    // history. Floor it by the nearest reachable tag instead; previousVersion stays null (no own tag).
    vi.mocked(getNearestReachableTag).mockResolvedValue('v0.9.0');
    const result = await new BaselineResolver(makeOpts()).resolve(makeInput({ latestTag: '', hasRealTag: false }));
    expect(result.revisionRange).toBe('v0.9.0..HEAD');
    expect(result.previousVersion).toBeNull();
    expect(result.baselineUnreachable).toBe(false);
    expect(verifyTag).not.toHaveBeenCalled();
  });

  it('should produce full history for an untagged package only in a fresh repo with no tags', async () => {
    vi.mocked(getNearestReachableTag).mockResolvedValue('');
    const result = await new BaselineResolver(makeOpts()).resolve(makeInput({ latestTag: '', hasRealTag: false }));
    expect(result.revisionRange).toBe('HEAD');
    expect(result.previousVersion).toBeNull();
    expect(verifyTag).not.toHaveBeenCalled();
  });

  it('should bound a manifest-fallback synthetic tag by the nearest reachable tag without calling git verify', async () => {
    vi.mocked(getNearestReachableTag).mockResolvedValue('v0.9.0');
    const result = await new BaselineResolver(makeOpts()).resolve(
      makeInput({ latestTag: 'v1.2.3', hasRealTag: false }),
    );
    expect(result.revisionRange).toBe('v0.9.0..HEAD');
    expect(result.baselineUnreachable).toBe(true);
    expect(result.previousVersion).toBeNull();
    expect(verifyTag).not.toHaveBeenCalled();
  });

  it('should aggregate from the last stable tag when a prerelease graduates (global series)', async () => {
    vi.mocked(verifyTag).mockResolvedValue(reachable);
    vi.mocked(getLatestStableTag).mockResolvedValue('v0.9.0');
    const result = await new BaselineResolver(makeOpts()).resolve(
      makeInput({ latestTag: 'v1.0.0-next.1', nextVersion: '1.0.0' }),
    );
    expect(getLatestStableTag).toHaveBeenCalledWith('v');
    expect(result.revisionRange).toBe('v0.9.0..HEAD');
    expect(result.previousVersion).toBe('v0.9.0');
  });

  it('should use the package-specific stable lookup on graduation when the tag came from that series', async () => {
    vi.mocked(verifyTag).mockResolvedValue(reachable);
    vi.mocked(getLatestStableTagForPackage).mockResolvedValue('pkg@v0.9.0');
    const result = await new BaselineResolver(makeOpts({ tagTemplate: '${packageName}@${prefix}${version}' })).resolve(
      makeInput({ latestTag: 'pkg@v1.0.0-next.1', nextVersion: '1.0.0', usedPackageSpecificTag: true }),
    );
    expect(getLatestStableTagForPackage).toHaveBeenCalledWith('pkg', 'v', {
      tagTemplate: '${packageName}@${prefix}${version}',
      packageSpecificTags: true,
    });
    expect(result.revisionRange).toBe('pkg@v0.9.0..HEAD');
  });

  it('should bound by the nearest reachable tag when graduating with no prior stable tag', async () => {
    vi.mocked(getLatestStableTag).mockResolvedValue('');
    vi.mocked(getNearestReachableTag).mockResolvedValue('v0.9.0');
    const result = await new BaselineResolver(makeOpts()).resolve(
      makeInput({ latestTag: 'v1.0.0-next.1', nextVersion: '1.0.0' }),
    );
    expect(result.revisionRange).toBe('v0.9.0..HEAD');
    // Range floors by the nearest reachable tag (#370); the LABEL still falls back to the prerelease
    // predecessor rather than rendering N/A (#474) — the two are decoupled.
    expect(result.previousVersion).toBe('v1.0.0-next.1');
    expect(verifyTag).not.toHaveBeenCalled();
  });

  it('should label previousVersion with the prerelease predecessor when graduating with no prior stable tag', async () => {
    // Graduation widens the range to the whole prerelease line by re-basing onto the last stable tag,
    // but with no prior stable that lookup returns '' — so the package's only predecessor is its
    // prerelease latestTag. Fall back to it for the label (kept in tag form so generateCompareUrl can
    // rebuild the `to` tag) instead of rendering N/A and mislabeling a graduating package a first
    // release. Realistic floor: git describe finds the prerelease tag itself as the nearest reachable.
    vi.mocked(getLatestStableTag).mockResolvedValue('');
    vi.mocked(getNearestReachableTag).mockResolvedValue('v1.1.0-next.0');
    const result = await new BaselineResolver(makeOpts()).resolve(
      makeInput({ latestTag: 'v1.1.0-next.0', nextVersion: '1.1.0' }),
    );
    expect(result.previousVersion).toBe('v1.1.0-next.0');
    expect(result.baselineUnreachable).toBe(false);
  });

  it('should still leave previousVersion null for a genuine first release with no prior tag', async () => {
    // The fallback only kicks in when there IS a tag to fall back to: with no tag at all, both
    // changelogBaseTag and latestTag are empty, so a true first release stays null → N/A.
    vi.mocked(getNearestReachableTag).mockResolvedValue('');
    const result = await new BaselineResolver(makeOpts()).resolve(makeInput({ latestTag: '', hasRealTag: false }));
    expect(result.previousVersion).toBeNull();
  });

  it('should strip a baseline marker tag back to consumer form for previousVersion', async () => {
    vi.mocked(verifyTag).mockResolvedValue(reachable);
    const result = await new BaselineResolver(makeOpts()).resolve(
      makeInput({ latestTag: 'release/v1.2.3', nextVersion: '1.2.4', baselineTagPrefix: 'release/v' }),
    );
    expect(result.revisionRange).toBe('release/v1.2.3..HEAD');
    expect(result.previousVersion).toBe('v1.2.3');
  });
});

describe('BaselineResolver.sharedFloor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return a package range unchanged when it is already bounded', async () => {
    const resolver = new BaselineResolver(makeOpts());
    expect(await resolver.sharedFloor('v1.0.0..HEAD')).toBe('v1.0.0..HEAD');
    expect(getNearestReachableTag).not.toHaveBeenCalled();
  });

  it('should bound a HEAD range by the nearest reachable tag and cache it', async () => {
    vi.mocked(getNearestReachableTag).mockResolvedValue('v1.0.0');
    const resolver = new BaselineResolver(makeOpts());
    expect(await resolver.sharedFloor('HEAD')).toBe('v1.0.0..HEAD');
    expect(await resolver.sharedFloor('HEAD')).toBe('v1.0.0..HEAD');
    expect(getNearestReachableTag).toHaveBeenCalledTimes(1);
  });

  it('should stay at HEAD when no reachable tag exists', async () => {
    vi.mocked(getNearestReachableTag).mockResolvedValue('');
    expect(await new BaselineResolver(makeOpts()).sharedFloor('HEAD')).toBe('HEAD');
  });

  it('should not apply a shared floor when baseRef scopes the run', async () => {
    const resolver = new BaselineResolver(makeOpts({ baseRef: 'abc123' }));
    expect(await resolver.sharedFloor('HEAD')).toBe('HEAD');
    expect(getNearestReachableTag).not.toHaveBeenCalled();
  });

  it('should keep the per-package range (union floor) in the default union mode', async () => {
    // Default: each releasing package contributes its own range; the union floors by the oldest.
    const resolver = new BaselineResolver(makeOpts({ sharedChangelogFloor: 'union' }));
    expect(await resolver.sharedFloor('electron-service@v10.0.0..HEAD')).toBe('electron-service@v10.0.0..HEAD');
    expect(getNearestReachableTag).not.toHaveBeenCalled();
  });

  it('should floor every package by the global nearest-reachable tag in sinceLastRelease mode', async () => {
    // Collapses the union: even a package with its OWN bounded (older) range is floored by the single
    // global nearest tag, so a global commit consumed by the most recent release doesn't recur.
    vi.mocked(getNearestReachableTag).mockResolvedValue('native-types@v2.4.0');
    const resolver = new BaselineResolver(makeOpts({ sharedChangelogFloor: 'sinceLastRelease' }));
    expect(await resolver.sharedFloor('electron-service@v10.0.0..HEAD')).toBe('native-types@v2.4.0..HEAD');
    expect(await resolver.sharedFloor('tauri-service@v1.1.0..HEAD')).toBe('native-types@v2.4.0..HEAD');
    expect(getNearestReachableTag).toHaveBeenCalledTimes(1); // cached across packages
  });

  it('should pass a baseRef run through unbounded even in sinceLastRelease mode', async () => {
    const resolver = new BaselineResolver(makeOpts({ sharedChangelogFloor: 'sinceLastRelease', baseRef: 'abc123' }));
    expect(await resolver.sharedFloor('abc123..HEAD')).toBe('abc123..HEAD');
    expect(getNearestReachableTag).not.toHaveBeenCalled();
  });
});
