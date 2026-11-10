import type { VersionOutput } from '@releasekit/core';
import type { PublishOutput, PublishResult } from '@releasekit/publish';
import { describe, expect, it } from 'vitest';
import {
  buildLedger,
  FAILURE_MARKER,
  parseFailureReportData,
  parseFailureReportStatus,
  renderFailureReport,
  renderResolvedReport,
  renderSupersedeWarning,
} from '../../src/failure-report/failure-report.js';

function versionOutputFor(
  packages: Array<{ name: string; version: string }>,
  overrides: Partial<VersionOutput> = {},
): VersionOutput {
  return {
    dryRun: false,
    strategy: 'async',
    updates: packages.map((p) => ({
      packageName: p.name,
      newVersion: p.version,
      filePath: `packages/${p.name}/package.json`,
    })),
    changelogs: [],
    tags: packages.map((p) => `${p.name}@v${p.version}`),
    ...overrides,
  };
}

function npmResult(partial: Partial<PublishResult> & { packageName: string; version: string }): PublishResult {
  return {
    registry: 'npm',
    updatePackageName: partial.packageName,
    success: true,
    skipped: false,
    ...partial,
  };
}

function publishOutputFor(npm: PublishResult[]): PublishOutput {
  return {
    dryRun: false,
    git: { committed: true, tags: [], pushed: false },
    npm,
    cargo: [],
    verification: [],
    githubReleases: [],
    publishSucceeded: false,
  };
}

describe('buildLedger', () => {
  it('should distinguish published / skipped / failed / not-attempted', () => {
    const versionOutput = versionOutputFor([
      { name: '@scope/a', version: '1.0.0' },
      { name: '@scope/b', version: '1.0.0' },
      { name: '@scope/c', version: '1.0.0' },
      { name: '@scope/d', version: '1.0.0' },
    ]);
    const publishOutput = publishOutputFor([
      npmResult({ packageName: '@scope/a', version: '1.0.0', success: true }),
      npmResult({ packageName: '@scope/b', version: '1.0.0', success: true, alreadyPublished: true }),
      npmResult({ packageName: '@scope/c', version: '1.0.0', success: false, reason: 'npm 403 Forbidden' }),
      // @scope/d has no result entry - the pipeline never reached it.
    ]);

    const ledger = buildLedger(versionOutput, publishOutput);

    expect(ledger).toEqual([
      { packageName: '@scope/a', version: '1.0.0', status: 'published', registry: 'npm', detail: undefined },
      {
        packageName: '@scope/b',
        version: '1.0.0',
        status: 'skipped',
        registry: 'npm',
        detail: 'already published',
      },
      { packageName: '@scope/c', version: '1.0.0', status: 'failed', registry: 'npm', detail: 'npm 403 Forbidden' },
      { packageName: '@scope/d', version: '1.0.0', status: 'not-attempted' },
    ]);
  });

  it('should exclude the root lockstep bump from the ledger', () => {
    const versionOutput = versionOutputFor([{ name: '@scope/a', version: '2.0.0' }], { strategy: 'sync' });
    versionOutput.updates.push({
      packageName: 'root',
      newVersion: '2.0.0',
      filePath: 'package.json',
      isRoot: true,
    });
    const ledger = buildLedger(versionOutput, publishOutputFor([]));
    expect(ledger.map((e) => e.packageName)).toEqual(['@scope/a']);
  });

  it('should keep the most significant outcome when a package appears on multiple registries', () => {
    const versionOutput = versionOutputFor([{ name: '@scope/a', version: '1.0.0' }]);
    const publishOutput = publishOutputFor([
      npmResult({ packageName: '@scope/a', version: '1.0.0', success: true, alreadyPublished: true }),
    ]);
    publishOutput.cargo = [
      {
        packageName: '@scope/a',
        updatePackageName: '@scope/a',
        version: '1.0.0',
        registry: 'cargo',
        success: false,
        skipped: false,
        reason: 'boom',
      },
    ];
    const ledger = buildLedger(versionOutput, publishOutput);
    expect(ledger[0]?.status).toBe('failed');
  });

  it("should match a hybrid package's pub.dev result by its update's name", () => {
    const versionOutput = versionOutputFor([{ name: 'my-package', version: '1.0.0' }]);
    const publishOutput = publishOutputFor([npmResult({ packageName: 'my-package', version: '1.0.0' })]);
    publishOutput.pub = [
      {
        packageName: 'my_package',
        updatePackageName: 'my-package',
        version: '1.0.0',
        registry: 'pub',
        success: false,
        skipped: false,
        reason: 'boom',
      },
    ];

    expect(buildLedger(versionOutput, publishOutput)).toEqual([
      { packageName: 'my-package', version: '1.0.0', status: 'failed', registry: 'pub', detail: 'boom' },
    ]);
  });
});

describe('renderFailureReport', () => {
  const versionOutput = versionOutputFor([
    { name: '@scope/a', version: '0.24.0' },
    { name: '@scope/b', version: '0.24.0' },
  ]);
  const publishOutput = publishOutputFor([
    npmResult({ packageName: '@scope/a', version: '0.24.0', success: true }),
    npmResult({ packageName: '@scope/b', version: '0.24.0', success: false, reason: 'npm 403' }),
  ]);

  it('should start with the distinct marker and an unresolved status line', () => {
    const body = renderFailureReport({
      versionOutput,
      publishOutput,
      failedStage: 'npm-publish',
      errorMessage: 'Failed to publish to npm: npm 403',
      recovery: { mode: 'standing-pr', standingPrNumber: 42 },
    });
    expect(body.startsWith(FAILURE_MARKER)).toBe(true);
    expect(parseFailureReportStatus(body)).toBe('unresolved');
  });

  it('should embed machine-readable headline data that round-trips independent of the prose', () => {
    const body = renderFailureReport({
      versionOutput,
      publishOutput,
      failedStage: 'npm-publish',
      errorMessage: 'Failed to publish to npm: npm 403',
      recovery: { mode: 'standing-pr', standingPrNumber: 42 },
    });
    expect(parseFailureReportData(body)).toEqual({ label: 'v0.24.0', published: 1, total: 2 });
    const copyEdited = body.replace('did not complete', 'failed partway through');
    expect(parseFailureReportData(copyEdited)).toEqual({ label: 'v0.24.0', published: 1, total: 2 });
  });

  it('should return null headline data for non-report bodies and malformed data comments', () => {
    expect(parseFailureReportData('not a report')).toBeNull();
    expect(
      parseFailureReportData(`${FAILURE_MARKER}\n<!-- releasekit-publish-failure-data: {bad json} -->`),
    ).toBeNull();
  });

  it('should render the per-package ledger with status icons and the published fraction', () => {
    const body = renderFailureReport({
      versionOutput,
      publishOutput,
      failedStage: 'npm-publish',
      errorMessage: 'npm 403',
      recovery: { mode: 'standing-pr', standingPrNumber: 42 },
    });
    expect(body).toContain('1/2 package(s) published');
    expect(body).toContain('| `@scope/a` | 0.24.0 | ✅ published |');
    expect(body).toContain('| `@scope/b` | 0.24.0 | ❌ failed | npm 403 |');
  });

  it('should include the failed stage, error message, and the safe-retry note', () => {
    const body = renderFailureReport({
      versionOutput,
      publishOutput,
      failedStage: 'npm-publish',
      errorMessage: 'Failed to publish to npm: npm 403',
      recovery: { mode: 'standing-pr', standingPrNumber: 42 },
    });
    expect(body).toContain('`npm-publish`');
    expect(body).toContain('Failed to publish to npm: npm 403');
    expect(body).toContain('Retrying is safe');
  });

  it('should give standing-pr recovery instructions with the PR number', () => {
    const body = renderFailureReport({
      versionOutput,
      publishOutput,
      failedStage: 'npm-publish',
      errorMessage: 'npm 403',
      recovery: { mode: 'standing-pr', standingPrNumber: 42 },
    });
    expect(body).toContain('--pr 42');
    expect(body).not.toContain('Re-run failed jobs');
  });

  it('should mention the release:retry label only when it is available', () => {
    const withRetry = renderFailureReport({
      versionOutput,
      publishOutput,
      failedStage: 'npm-publish',
      errorMessage: 'npm 403',
      recovery: { mode: 'standing-pr', standingPrNumber: 42, retryLabelAvailable: true },
    });
    expect(withRetry).toContain('release:retry');

    const withoutRetry = renderFailureReport({
      versionOutput,
      publishOutput,
      failedStage: 'npm-publish',
      errorMessage: 'npm 403',
      recovery: { mode: 'standing-pr', standingPrNumber: 42 },
    });
    expect(withoutRetry).not.toContain('release:retry');
  });

  it('should make the release:retry label the primary recovery path when available', () => {
    const body = renderFailureReport({
      versionOutput,
      publishOutput,
      failedStage: 'npm-publish',
      errorMessage: 'npm 403',
      recovery: { mode: 'standing-pr', standingPrNumber: 42, retryLabelAvailable: true },
    });
    const labelIdx = body.indexOf('release:retry');
    const dispatchIdx = body.indexOf('--pr 42');
    expect(labelIdx).toBeGreaterThanOrEqual(0);
    expect(dispatchIdx).toBeGreaterThanOrEqual(0);
    expect(labelIdx).toBeLessThan(dispatchIdx);
    expect(body).toContain('re-apply');
    expect(body).toContain('#42');
  });

  it('should give direct-mode recovery instructions (re-run failed jobs)', () => {
    const body = renderFailureReport({
      versionOutput,
      publishOutput,
      failedStage: 'npm-publish',
      errorMessage: 'npm 403',
      recovery: { mode: 'direct' },
    });
    expect(body).toContain('Re-run failed jobs');
    expect(body).not.toContain('--pr');
  });

  it('should tell a per-package direct failure to roll forward only after a push', () => {
    const tagged = versionOutputFor([{ name: '@scope/a', version: '1.0.0' }]);
    tagged.updates[0] = { ...tagged.updates[0], tag: '@scope/a@v1.0.0' };
    const pushed = { ...publishOutput, git: { ...publishOutput.git, pushed: true } };
    const body = renderFailureReport({
      versionOutput: tagged,
      publishOutput: pushed,
      failedStage: 'npm-publish',
      errorMessage: 'npm 403',
      recovery: { mode: 'direct' },
    });
    expect(body).toContain('Roll forward');
    expect(body).toContain('do not delete them');
    expect(body).not.toContain('Re-run failed jobs');
    expect(body).not.toContain('Retrying is safe');
  });

  it('should keep retry instructions when the branch push itself failed', () => {
    const committed = { ...publishOutput, git: { ...publishOutput.git, committed: true, pushed: false } };
    const body = renderFailureReport({
      versionOutput: versionOutputFor([{ name: '@scope/a', version: '1.0.0' }]),
      publishOutput: committed,
      failedStage: 'git-push',
      errorMessage: 'push rejected',
      recovery: { mode: 'direct' },
    });
    expect(body).toContain('failed before the branch was pushed');
    expect(body).toContain('Re-run failed jobs');
    expect(body).not.toContain('Roll forward');
  });

  describe('when the branch push landed but a tag push failed', () => {
    const syncRelease = versionOutputFor([{ name: '@scope/a', version: '1.2.0' }], {
      strategy: 'sync',
      tags: ['v1.2.0'],
    });
    const branchOnly = {
      ...publishOutputFor([npmResult({ packageName: '@scope/a', version: '1.2.0' })]),
      git: { committed: true, tags: ['v1.2.0'], pushed: false, branch: 'main', commitSha: 'abc1234' },
    };

    it.each(['direct', 'manual'] as const)('should recommend rolling forward, not a re-run (%s)', (mode) => {
      const body = renderFailureReport({
        versionOutput: syncRelease,
        publishOutput: branchOnly,
        failedStage: 'git-push',
        errorMessage: 'GH013: Repository rule violations found for refs/tags/v1.2.0',
        recovery: { mode },
      });
      expect(body).toContain('The release commit reached `main`, but a tag push failed');
      expect(body).toContain('Roll forward with the next release. It bumps past this release');
      expect(body).toContain("Don't re-run the release");
      expect(body).not.toContain('Re-run failed jobs');
      expect(body).not.toContain('Re-run the release workflow');
      expect(body).not.toContain('Retrying is safe');
    });

    it('should print the commands to restore the missing tags on the release commit', () => {
      const body = renderFailureReport({
        versionOutput: syncRelease,
        publishOutput: {
          ...branchOnly,
          git: { ...branchOnly.git, tags: ['v1.2.0', 'release/v1.2.0', 'v1.2.0'], remote: 'upstream' },
        },
        failedStage: 'git-push',
        errorMessage: 'tag push rejected',
        recovery: { mode: 'direct' },
      });
      expect(body).toContain(
        [
          'Run these, skipping the `git tag` line for any tag that already exists:',
          '',
          '```sh',
          'git fetch upstream',
          'git tag v1.2.0 abc1234',
          'git tag release/v1.2.0 abc1234',
          'git push upstream v1.2.0',
          'git push upstream release/v1.2.0',
          '```',
        ].join('\n'),
      );
    });

    it('should say why the tags need restoring before the next release', () => {
      const body = renderFailureReport({
        versionOutput: syncRelease,
        publishOutput: branchOnly,
        failedStage: 'git-push',
        errorMessage: 'tag push rejected',
        recovery: { mode: 'direct' },
      });
      expect(body).toContain(
        "Restore the missing tags before the next release. Without them it counts from the previous tag, so its changelog repeats this release's entries and its bump counts this release's commits again. Under `mismatchStrategy: 'error'` it can also throw a version mismatch if this release moved onto or off a prerelease.",
      );
    });

    it("should restore the published package's tag and the baseline tag when the first per-package tag push fails", () => {
      const tagged = versionOutputFor([
        { name: '@scope/a', version: '1.0.0' },
        { name: '@scope/b', version: '1.0.0' },
      ]);
      tagged.updates = tagged.updates.map((u) => ({ ...u, tag: `${u.packageName}@v${u.newVersion}` }));
      tagged.baselineTags = ['v1.0.0'];
      const body = renderFailureReport({
        versionOutput: tagged,
        publishOutput: {
          ...publishOutputFor([npmResult({ packageName: '@scope/a', version: '1.0.0' })]),
          git: {
            committed: true,
            tags: ['@scope/a@v1.0.0', '@scope/b@v1.0.0'],
            pushed: false,
            branch: 'main',
            commitSha: 'abc1234',
          },
        },
        failedStage: 'git-push',
        errorMessage: 'tag push rejected',
        recovery: { mode: 'direct' },
      });
      expect(body).toContain('Roll forward with the next release. It bumps past this release');
      expect(body).toContain(
        [
          'git tag @scope/a@v1.0.0 abc1234',
          'git tag v1.0.0 abc1234',
          'git push origin @scope/a@v1.0.0',
          'git push origin v1.0.0',
        ].join('\n'),
      );
      expect(body).not.toContain('@scope/b@v1.0.0');
      expect(body).not.toContain('Re-run failed jobs');
    });
  });

  it('should keep retry instructions when a per-package run pushed nothing', () => {
    const tagged = versionOutputFor([{ name: '@scope/a', version: '1.0.0' }]);
    tagged.updates[0] = { ...tagged.updates[0], tag: '@scope/a@v1.0.0' };
    const body = renderFailureReport({
      versionOutput: tagged,
      publishOutput,
      failedStage: 'npm-publish',
      errorMessage: 'npm 403',
      recovery: { mode: 'direct' },
    });
    expect(body).toContain('Re-run failed jobs');
    expect(body).not.toContain('Roll forward');
  });
});

describe('renderResolvedReport', () => {
  it('should keep the marker and encode resolved status', () => {
    const versionOutput = versionOutputFor([{ name: '@scope/a', version: '0.24.0' }]);
    const body = renderResolvedReport(versionOutput);
    expect(body.startsWith(FAILURE_MARKER)).toBe(true);
    expect(parseFailureReportStatus(body)).toBe('resolved');
    expect(body).toContain('recovered');
  });
});

describe('parseFailureReportStatus', () => {
  it('should return null for a non-report body', () => {
    expect(parseFailureReportStatus('just a normal comment')).toBeNull();
  });

  it('should default to unresolved when the status line is missing', () => {
    expect(parseFailureReportStatus(`${FAILURE_MARKER}\n\n## something`)).toBe('unresolved');
  });
});

describe('renderSupersedeWarning', () => {
  it('should state the partial-publish fraction and both recovery paths', () => {
    const lines = renderSupersedeWarning({
      previousLabel: 'v0.24.0',
      published: 2,
      total: 4,
      standingPrNumber: 42,
    });
    const text = lines.join('\n');
    expect(text).toContain('v0.24.0 is partially published');
    expect(text).toContain('2/4 packages');
    expect(text).toContain('#42');
    expect(text).toContain('supersedes it');
  });

  it('should reference the release:retry label as the primary reconcile path when available', () => {
    const text = renderSupersedeWarning({
      previousLabel: 'v0.24.0',
      published: 2,
      total: 4,
      standingPrNumber: 42,
      retryLabelAvailable: true,
    }).join('\n');
    expect(text).toContain('release:retry');
    expect(text).toContain('supersedes it');
  });

  it('should fall back to the dispatch instruction when the label is not available', () => {
    const text = renderSupersedeWarning({
      previousLabel: 'v0.24.0',
      published: 2,
      total: 4,
      standingPrNumber: 42,
    }).join('\n');
    expect(text).not.toContain('release:retry');
    expect(text).toContain('dispatching the release workflow');
  });
});
