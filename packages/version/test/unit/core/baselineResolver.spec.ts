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
    vi.mocked(verifyTag).mockReturnValue(reachable);
    const result = await new BaselineResolver(makeOpts()).resolve(makeInput());
    expect(result.revisionRange).toBe('v1.0.0..HEAD');
    expect(result.previousVersion).toBe('v1.0.0');
    expect(result.baselineUnreachable).toBe(false);
  });

  it('should bound by the nearest reachable tag (not full history) when the tag is unreachable (#370)', async () => {
    vi.mocked(verifyTag).mockReturnValue(unreachable);
    vi.mocked(getNearestReachableTag).mockReturnValue('v0.9.0');
    const result = await new BaselineResolver(makeOpts()).resolve(makeInput());
    // The own (unreachable) baseline floods full history; #370 floors it by the nearest reachable tag.
    expect(result.revisionRange).toBe('v0.9.0..HEAD');
    // …but previousVersion stays null: we diffed the nearest tag, not the package's own baseline.
    expect(result.previousVersion).toBeNull();
    expect(result.baselineUnreachable).toBe(true);
  });

  it('should fall back to full history only when no reachable tag exists at all (fresh repo, #370)', async () => {
    vi.mocked(verifyTag).mockReturnValue(unreachable);
    vi.mocked(getNearestReachableTag).mockReturnValue('');
    const result = await new BaselineResolver(makeOpts()).resolve(makeInput());
    expect(result.revisionRange).toBe('HEAD');
    expect(result.previousVersion).toBeNull();
    expect(result.baselineUnreachable).toBe(true);
  });

  it('should throw a StrictReachableError on an unreachable baseline when strictReachable is set', async () => {
    vi.mocked(verifyTag).mockReturnValue(unreachable);
    // The type — not just the message — is the contract (#372): the per-package changelog catch in
    // each strategy distinguishes this from a genuine extraction error by `instanceof` and rethrows
    // it so the run aborts, instead of degrading to a minimal changelog entry.
    const promise = new BaselineResolver(makeOpts({ strictReachable: true })).resolve(makeInput());
    await expect(promise).rejects.toBeInstanceOf(StrictReachableError);
    await expect(promise).rejects.toThrow(/not reachable/);
  });

  it('should not throw under strictReachable when baseRef is set (baseRef takes precedence)', async () => {
    vi.mocked(verifyTag).mockReturnValue(unreachable);
    const result = await new BaselineResolver(makeOpts({ strictReachable: true, baseRef: 'abc123' })).resolve(
      makeInput(),
    );
    expect(result.revisionRange).toBe('HEAD');
    expect(result.baselineUnreachable).toBe(true);
    // baseRef short-circuits before the nearest-reachable floor in every variant — assert it here too.
    expect(getNearestReachableTag).not.toHaveBeenCalled();
  });

  it('should keep the full-history fallback for an unreachable baseRef, not the nearest-reachable floor (#370)', async () => {
    // baseRef scopes the run to a PR's commits — a different intent from the tag floor, so an
    // unreachable baseRef stays at HEAD rather than borrowing the nearest tag (mirrors sharedFloor).
    vi.mocked(verifyTag).mockReturnValue(unreachable);
    const result = await new BaselineResolver(makeOpts({ baseRef: 'abc123' })).resolve(makeInput());
    expect(result.revisionRange).toBe('HEAD');
    expect(result.baselineUnreachable).toBe(true);
    expect(getNearestReachableTag).not.toHaveBeenCalled();
  });

  it('should use baseRef as the floor when set, overriding the tag', async () => {
    vi.mocked(verifyTag).mockReturnValue(reachable);
    const result = await new BaselineResolver(makeOpts({ baseRef: 'abc123' })).resolve(makeInput());
    expect(verifyTag).toHaveBeenCalledWith('abc123', '/repo');
    expect(result.revisionRange).toBe('abc123..HEAD');
  });

  it('should bound an untagged package by the nearest reachable tag, not full history (#370)', async () => {
    // The standing-PR-body flood: a new package in a tagged repo would otherwise summarize ALL
    // history. Floor it by the nearest reachable tag instead; previousVersion stays null (no own tag).
    vi.mocked(getNearestReachableTag).mockReturnValue('v0.9.0');
    const result = await new BaselineResolver(makeOpts()).resolve(makeInput({ latestTag: '', hasRealTag: false }));
    expect(result.revisionRange).toBe('v0.9.0..HEAD');
    expect(result.previousVersion).toBeNull();
    expect(result.baselineUnreachable).toBe(false);
    expect(verifyTag).not.toHaveBeenCalled();
  });

  it('should produce full history for an untagged package only in a fresh repo with no tags (#370)', async () => {
    vi.mocked(getNearestReachableTag).mockReturnValue('');
    const result = await new BaselineResolver(makeOpts()).resolve(makeInput({ latestTag: '', hasRealTag: false }));
    expect(result.revisionRange).toBe('HEAD');
    expect(result.previousVersion).toBeNull();
    expect(verifyTag).not.toHaveBeenCalled();
  });

  it('should bound a manifest-fallback synthetic tag by the nearest reachable tag without calling git verify (#370)', async () => {
    vi.mocked(getNearestReachableTag).mockReturnValue('v0.9.0');
    const result = await new BaselineResolver(makeOpts()).resolve(
      makeInput({ latestTag: 'v1.2.3', hasRealTag: false }),
    );
    expect(result.revisionRange).toBe('v0.9.0..HEAD');
    expect(result.baselineUnreachable).toBe(true);
    expect(result.previousVersion).toBeNull();
    expect(verifyTag).not.toHaveBeenCalled();
  });

  it('should aggregate from the last stable tag when a prerelease graduates (global series)', async () => {
    vi.mocked(verifyTag).mockReturnValue(reachable);
    vi.mocked(getLatestStableTag).mockResolvedValue('v0.9.0');
    const result = await new BaselineResolver(makeOpts()).resolve(
      makeInput({ latestTag: 'v1.0.0-next.1', nextVersion: '1.0.0' }),
    );
    expect(getLatestStableTag).toHaveBeenCalledWith('v');
    expect(result.revisionRange).toBe('v0.9.0..HEAD');
    expect(result.previousVersion).toBe('v0.9.0');
  });

  it('should use the package-specific stable lookup on graduation when the tag came from that series', async () => {
    vi.mocked(verifyTag).mockReturnValue(reachable);
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

  it('should bound by the nearest reachable tag when graduating with no prior stable tag (#370)', async () => {
    vi.mocked(getLatestStableTag).mockResolvedValue('');
    vi.mocked(getNearestReachableTag).mockReturnValue('v0.9.0');
    const result = await new BaselineResolver(makeOpts()).resolve(
      makeInput({ latestTag: 'v1.0.0-next.1', nextVersion: '1.0.0' }),
    );
    expect(result.revisionRange).toBe('v0.9.0..HEAD');
    expect(result.previousVersion).toBeNull();
    expect(verifyTag).not.toHaveBeenCalled();
  });

  it('should strip a baseline marker tag back to consumer form for previousVersion (#330)', async () => {
    vi.mocked(verifyTag).mockReturnValue(reachable);
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

  it('should return a package range unchanged when it is already bounded', () => {
    const resolver = new BaselineResolver(makeOpts());
    expect(resolver.sharedFloor('v1.0.0..HEAD')).toBe('v1.0.0..HEAD');
    expect(getNearestReachableTag).not.toHaveBeenCalled();
  });

  it('should bound a HEAD range by the nearest reachable tag and cache it (#348)', () => {
    vi.mocked(getNearestReachableTag).mockReturnValue('v1.0.0');
    const resolver = new BaselineResolver(makeOpts());
    expect(resolver.sharedFloor('HEAD')).toBe('v1.0.0..HEAD');
    expect(resolver.sharedFloor('HEAD')).toBe('v1.0.0..HEAD');
    expect(getNearestReachableTag).toHaveBeenCalledTimes(1);
  });

  it('should stay at HEAD when no reachable tag exists', () => {
    vi.mocked(getNearestReachableTag).mockReturnValue('');
    expect(new BaselineResolver(makeOpts()).sharedFloor('HEAD')).toBe('HEAD');
  });

  it('should not apply a shared floor when baseRef scopes the run', () => {
    const resolver = new BaselineResolver(makeOpts({ baseRef: 'abc123' }));
    expect(resolver.sharedFloor('HEAD')).toBe('HEAD');
    expect(getNearestReachableTag).not.toHaveBeenCalled();
  });

  it('should keep the per-package range (union floor) in the default union mode', () => {
    // Default: each releasing package contributes its own range; the union floors by the oldest.
    const resolver = new BaselineResolver(makeOpts({ sharedChangelogFloor: 'union' }));
    expect(resolver.sharedFloor('electron-service@v10.0.0..HEAD')).toBe('electron-service@v10.0.0..HEAD');
    expect(getNearestReachableTag).not.toHaveBeenCalled();
  });

  it('should floor every package by the global nearest-reachable tag in sinceLastRelease mode (#398)', () => {
    // Collapses the union: even a package with its OWN bounded (older) range is floored by the single
    // global nearest tag, so a global commit consumed by the most recent release doesn't recur.
    vi.mocked(getNearestReachableTag).mockReturnValue('native-types@v2.4.0');
    const resolver = new BaselineResolver(makeOpts({ sharedChangelogFloor: 'sinceLastRelease' }));
    expect(resolver.sharedFloor('electron-service@v10.0.0..HEAD')).toBe('native-types@v2.4.0..HEAD');
    expect(resolver.sharedFloor('tauri-service@v1.1.0..HEAD')).toBe('native-types@v2.4.0..HEAD');
    expect(getNearestReachableTag).toHaveBeenCalledTimes(1); // cached across packages
  });

  it('should pass a baseRef run through unbounded even in sinceLastRelease mode (#398)', () => {
    const resolver = new BaselineResolver(makeOpts({ sharedChangelogFloor: 'sinceLastRelease', baseRef: 'abc123' }));
    expect(resolver.sharedFloor('abc123..HEAD')).toBe('abc123..HEAD');
    expect(getNearestReachableTag).not.toHaveBeenCalled();
  });
});
