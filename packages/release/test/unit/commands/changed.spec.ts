import type { PublishOutput, PublishResult } from '@releasekit/publish';
import { describe, expect, it } from 'vitest';
import { publishDidChange } from '../../../src/commands/changed.js';
import type { ReleaseOutput } from '../../../src/types.js';

function publishResult(overrides: Partial<PublishResult> = {}): PublishResult {
  return {
    packageName: '@acme/widget',
    version: '2.0.0',
    registry: 'npm',
    success: true,
    skipped: false,
    ...overrides,
  };
}

function publishOutput(overrides: Partial<PublishOutput> = {}): PublishOutput {
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

function releaseOutput(publish?: PublishOutput): ReleaseOutput {
  return {
    // Always populated from the manifest, whether or not this run published anything — the reason
    // `changed` can't be derived from it.
    versionOutput: {
      dryRun: false,
      updates: [{ packageName: '@acme/widget', currentVersion: '1.4.2', newVersion: '2.0.0', bumpType: 'major' }],
      changelogs: [],
      tags: ['v2.0.0'],
    } as ReleaseOutput['versionOutput'],
    notesGenerated: false,
    publishOutput: publish,
  };
}

describe('publishDidChange', () => {
  it('should be true when a package actually reached a registry', () => {
    expect(publishDidChange(releaseOutput(publishOutput({ npm: [publishResult()] })))).toBe(true);
  });

  it('should be false when every package was already published', () => {
    const output = publishOutput({
      npm: [publishResult({ skipped: true, alreadyPublished: true, reason: 'already published' })],
    });
    expect(publishDidChange(releaseOutput(output))).toBe(false);
  });

  it('should be false when every package was skipped as private', () => {
    const output = publishOutput({ npm: [publishResult({ skipped: true, reason: 'private' })] });
    expect(publishDidChange(releaseOutput(output))).toBe(false);
  });

  it('should be false for a push of pre-existing tags and releases with nothing published', () => {
    const output = publishOutput({
      npm: [publishResult({ skipped: true, alreadyPublished: true })],
      // Both report success for an already-existing tag/release, so neither is a change signal.
      git: { committed: true, tags: ['v2.0.0'], pushed: true },
      githubReleases: [{ tag: 'v2.0.0', draft: false, prerelease: false, success: true }],
    });
    expect(publishDidChange(releaseOutput(output))).toBe(false);
  });

  it('should be true when one package published among already-published ones', () => {
    const output = publishOutput({
      npm: [publishResult({ packageName: '@acme/a', skipped: true, alreadyPublished: true }), publishResult()],
    });
    expect(publishDidChange(releaseOutput(output))).toBe(true);
  });

  it('should read cargo and pub results alongside npm', () => {
    expect(publishDidChange(releaseOutput(publishOutput({ cargo: [publishResult({ registry: 'cargo' })] })))).toBe(
      true,
    );
    expect(publishDidChange(releaseOutput(publishOutput({ pub: [publishResult({ registry: 'pub' })] })))).toBe(true);
  });

  it('should be false for a dry run that reports successful publishes', () => {
    const output = publishOutput({ dryRun: true, npm: [publishResult()] });
    expect(publishDidChange(releaseOutput(output))).toBe(false);
  });

  it('should be false when there is no publish output at all', () => {
    expect(publishDidChange(releaseOutput(undefined))).toBe(false);
    expect(publishDidChange(null)).toBe(false);
  });
});
