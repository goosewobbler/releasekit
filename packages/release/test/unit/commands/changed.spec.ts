import type { PublishOutput, PublishResult } from '@releasekit/publish';
import { describe, expect, it } from 'vitest';
import { releaseDidPublish } from '../../../src/commands/changed.js';
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
    publishOutput: publish,
  } as ReleaseOutput;
}

// The predicate itself is covered in @releasekit/publish (output.spec.ts); these pin the
// standing-pr wiring: `changed` follows what this invocation published, never the manifest.
describe('releaseDidPublish', () => {
  it('should be true when this run published a package', () => {
    expect(releaseDidPublish(releaseOutput(publishOutput({ npm: [publishResult()] })))).toBe(true);
  });

  it('should be false on a re-run where every version was already published, despite manifest updates', () => {
    const out = releaseOutput(publishOutput({ npm: [publishResult({ skipped: true, alreadyPublished: true })] }));
    expect(releaseDidPublish(out)).toBe(false);
  });

  it('should be false when nothing was published at all', () => {
    expect(releaseDidPublish(releaseOutput(undefined))).toBe(false);
    expect(releaseDidPublish(undefined)).toBe(false);
  });
});
