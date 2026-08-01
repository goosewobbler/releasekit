import { describe, expect, it } from 'vitest';
import { publishDidChange } from '../../src/output.js';
import type { PublishOutput, PublishResult } from '../../src/types.js';

function result(overrides: Partial<PublishResult> = {}): PublishResult {
  return {
    packageName: '@acme/widget',
    version: '2.0.0',
    registry: 'npm',
    success: true,
    skipped: false,
    ...overrides,
  };
}

function output(overrides: Partial<PublishOutput> = {}): PublishOutput {
  return {
    dryRun: false,
    git: { committed: false, tags: ['v2.0.0'], pushed: true },
    npm: [],
    cargo: [],
    pub: [],
    verification: [],
    githubReleases: [],
    publishSucceeded: true,
    ...overrides,
  };
}

describe('publishDidChange', () => {
  it('should be true when a package actually reached a registry', () => {
    expect(publishDidChange(output({ npm: [result()] }))).toBe(true);
  });

  it('should be false when every package was already published', () => {
    expect(publishDidChange(output({ npm: [result({ skipped: true, alreadyPublished: true })] }))).toBe(false);
  });

  it('should be false when every package was skipped as private', () => {
    expect(publishDidChange(output({ npm: [result({ skipped: true, reason: 'private' })] }))).toBe(false);
  });

  it('should be false for a push of pre-existing tags and releases with nothing published', () => {
    // git.pushed is set for any push attempt and the GitHub-release stage reports success for an
    // already-existing release, so neither can stand in for "something happened".
    const out = output({
      npm: [result({ skipped: true, alreadyPublished: true })],
      git: { committed: true, tags: ['v2.0.0'], pushed: true },
      githubReleases: [{ tag: 'v2.0.0', draft: false, prerelease: false, success: true }],
    });
    expect(publishDidChange(out)).toBe(false);
  });

  it('should be true when one package published among already-published ones', () => {
    const out = output({
      npm: [result({ packageName: '@acme/a', skipped: true, alreadyPublished: true }), result()],
    });
    expect(publishDidChange(out)).toBe(true);
  });

  it('should read cargo and pub results alongside npm', () => {
    expect(publishDidChange(output({ cargo: [result({ registry: 'cargo' })] }))).toBe(true);
    expect(publishDidChange(output({ pub: [result({ registry: 'pub' })] }))).toBe(true);
  });

  it('should be false for a dry run that reports successful publishes', () => {
    expect(publishDidChange(output({ dryRun: true, npm: [result()] }))).toBe(false);
  });

  it('should be false for missing output', () => {
    expect(publishDidChange(undefined)).toBe(false);
    expect(publishDidChange(null)).toBe(false);
  });
});
