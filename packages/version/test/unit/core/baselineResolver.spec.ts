import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BaselineResolver, type BaselineResolverOptions } from '../../../src/core/baselineResolver.js';
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

  it('should fall back to full history and null previousVersion when the tag is unreachable (#339)', async () => {
    vi.mocked(verifyTag).mockReturnValue(unreachable);
    const result = await new BaselineResolver(makeOpts()).resolve(makeInput());
    expect(result.revisionRange).toBe('HEAD');
    expect(result.previousVersion).toBeNull();
    expect(result.baselineUnreachable).toBe(true);
  });

  it('should throw on an unreachable baseline when strictReachable is set', async () => {
    vi.mocked(verifyTag).mockReturnValue(unreachable);
    await expect(new BaselineResolver(makeOpts({ strictReachable: true })).resolve(makeInput())).rejects.toThrow(
      /not reachable/,
    );
  });

  it('should not throw under strictReachable when baseRef is set (baseRef takes precedence)', async () => {
    vi.mocked(verifyTag).mockReturnValue(unreachable);
    const result = await new BaselineResolver(makeOpts({ strictReachable: true, baseRef: 'abc123' })).resolve(
      makeInput(),
    );
    expect(result.revisionRange).toBe('HEAD');
    expect(result.baselineUnreachable).toBe(true);
  });

  it('should use baseRef as the floor when set, overriding the tag', async () => {
    vi.mocked(verifyTag).mockReturnValue(reachable);
    const result = await new BaselineResolver(makeOpts({ baseRef: 'abc123' })).resolve(makeInput());
    expect(verifyTag).toHaveBeenCalledWith('abc123', '/repo');
    expect(result.revisionRange).toBe('abc123..HEAD');
  });

  it('should produce full history with no previousVersion for an untagged package', async () => {
    const result = await new BaselineResolver(makeOpts()).resolve(makeInput({ latestTag: '', hasRealTag: false }));
    expect(result.revisionRange).toBe('HEAD');
    expect(result.previousVersion).toBeNull();
    expect(result.baselineUnreachable).toBe(false);
    expect(verifyTag).not.toHaveBeenCalled();
  });

  it('should treat a manifest-fallback synthetic tag as unreachable without calling git', async () => {
    const result = await new BaselineResolver(makeOpts()).resolve(
      makeInput({ latestTag: 'v1.2.3', hasRealTag: false }),
    );
    expect(result.revisionRange).toBe('HEAD');
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

  it('should fall through to full history when graduating with no prior stable tag', async () => {
    vi.mocked(getLatestStableTag).mockResolvedValue('');
    const result = await new BaselineResolver(makeOpts()).resolve(
      makeInput({ latestTag: 'v1.0.0-next.1', nextVersion: '1.0.0' }),
    );
    expect(result.revisionRange).toBe('HEAD');
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
});
