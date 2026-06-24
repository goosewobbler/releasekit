import { describe, expect, it } from 'vitest';

import { resolveVersionAction } from '../../../src/utils/versionAction.js';

describe('resolveVersionAction', () => {
  it('should report first-release when hasNoTags is true', () => {
    const result = resolveVersionAction({ hasNoTags: true, latestTag: '', nextVersion: '1.0.0' });
    expect(result.action).toBe('first-release');
    expect(result.reason).toMatch(/first release/i);
  });

  it('should report first-release when there is no latestTag even if hasNoTags is false', () => {
    // Defensive: an empty latestTag with hasNoTags mistakenly false still means no prior release.
    const result = resolveVersionAction({ hasNoTags: false, latestTag: '', nextVersion: '1.0.0' });
    expect(result.action).toBe('first-release');
  });

  it('should report graduated when a prerelease tag resolves to its stable form', () => {
    const result = resolveVersionAction({ hasNoTags: false, latestTag: 'v1.0.0-next.1', nextVersion: '1.0.0' });
    expect(result.action).toBe('graduated');
    expect(result.reason).toBe('Graduated 1.0.0-next.1 → 1.0.0 (bump ignored).');
  });

  it('should report graduated for a package-scoped prerelease tag', () => {
    const result = resolveVersionAction({
      hasNoTags: false,
      latestTag: '@scope/pkg@v2.3.0-beta.4',
      nextVersion: '2.3.0',
    });
    expect(result.action).toBe('graduated');
    expect(result.reason).toBe('Graduated 2.3.0-beta.4 → 2.3.0 (bump ignored).');
  });

  it('should report bumped for a normal stable-to-stable bump', () => {
    const result = resolveVersionAction({ hasNoTags: false, latestTag: 'v1.0.0', nextVersion: '1.1.0' });
    expect(result.action).toBe('bumped');
    expect(result.reason).toBe('Bumped to 1.1.0.');
  });

  it('should report bumped when a prerelease advances to a higher base (not graduation)', () => {
    // 1.0.0-next.1 -> 1.1.0 is a real bump, not a graduation of the same base, so it stays bumped.
    const result = resolveVersionAction({ hasNoTags: false, latestTag: 'v1.0.0-next.1', nextVersion: '1.1.0' });
    expect(result.action).toBe('bumped');
  });

  it('should report bumped when a prerelease advances to another prerelease', () => {
    const result = resolveVersionAction({
      hasNoTags: false,
      latestTag: 'v1.0.0-next.1',
      nextVersion: '1.0.0-next.2',
    });
    expect(result.action).toBe('bumped');
  });

  it('should fall back to bumped when the prior tag cannot be parsed', () => {
    const result = resolveVersionAction({ hasNoTags: false, latestTag: 'not-a-version', nextVersion: '1.0.0' });
    expect(result.action).toBe('bumped');
    expect(result.reason).toBe('Bumped to 1.0.0.');
  });

  it('should never throw on malformed input and default to bumped', () => {
    expect(() =>
      resolveVersionAction({ hasNoTags: false, latestTag: 'vvv...---', nextVersion: 'garbage' }),
    ).not.toThrow();
    const result = resolveVersionAction({ hasNoTags: false, latestTag: 'vvv...---', nextVersion: 'garbage' });
    expect(result.action).toBe('bumped');
  });
});
