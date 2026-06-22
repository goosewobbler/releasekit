import type { VersionOutput } from '@releasekit/core';
import { createFakeForge } from '@releasekit/forge';
import { PipelineError, type PublishOutput, type PublishResult } from '@releasekit/publish';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FAILURE_MARKER, renderFailureReport, renderResolvedReport } from '../../src/failure-report/failure-report.js';
import {
  detectUnresolvedFailure,
  postFailureReport,
  resolveFailureReportIfPresent,
} from '../../src/failure-report/post.js';

function versionOutputFor(packages: Array<{ name: string; version: string }>): VersionOutput {
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

function pipelineErrorFor(versionOutput: VersionOutput): PipelineError {
  const publishOutput = publishOutputFor([
    { packageName: '@scope/a', version: '0.24.0', registry: 'npm', success: true, skipped: false },
    { packageName: '@scope/b', version: '0.24.0', registry: 'npm', success: false, skipped: false, reason: 'npm 403' },
  ]);
  void versionOutput;
  return new PipelineError('Failed to publish to npm: npm 403', 'npm-publish', publishOutput);
}

/** A forge seeded with existing comments, exposing its recorded create/update writes for assertions. */
function fakeForgeWith(comments: Array<{ id: number; body: string }> = []) {
  return createFakeForge({ comments });
}

const versionOutput = versionOutputFor([
  { name: '@scope/a', version: '0.24.0' },
  { name: '@scope/b', version: '0.24.0' },
]);

describe('postFailureReport', () => {
  it('should create a new marker comment when none exists', async () => {
    const forge = fakeForgeWith([]);
    await postFailureReport(
      { forge, mode: 'standing-pr', prNumber: 42, standingPrNumber: 42 },
      versionOutput,
      pipelineErrorFor(versionOutput),
    );
    expect(forge.createdComments).toHaveLength(1);
    const body = forge.createdComments[0]?.body as string;
    expect(body.startsWith(FAILURE_MARKER)).toBe(true);
    expect(body).toContain('1/2 package(s) published');
  });

  it('should update the existing report on a repeated failure (idempotent — does not stack)', async () => {
    const existing = renderFailureReport({
      versionOutput,
      publishOutput: publishOutputFor([]),
      failedStage: 'npm-publish',
      errorMessage: 'older error',
      recovery: { mode: 'standing-pr', standingPrNumber: 42 },
    });
    const forge = fakeForgeWith([{ id: 7, body: existing }]);
    await postFailureReport(
      { forge, mode: 'standing-pr', prNumber: 42, standingPrNumber: 42 },
      versionOutput,
      pipelineErrorFor(versionOutput),
    );
    expect(forge.createdComments).toHaveLength(0);
    expect(forge.updatedComments).toHaveLength(1);
    expect(forge.updatedComments[0]?.commentId).toBe(7);
  });

  it('should write to the step summary when no PR is available (manual dispatch)', async () => {
    const tmp = `${process.env.RUNNER_TEMP ?? '/tmp'}/rk-step-summary-${Date.now()}.md`;
    const fs = await import('node:fs');
    process.env.GITHUB_STEP_SUMMARY = tmp;
    try {
      const forge = fakeForgeWith([]);
      await postFailureReport({ forge, mode: 'manual' }, versionOutput, pipelineErrorFor(versionOutput));
      expect(forge.createdComments).toHaveLength(0);
      const written = fs.readFileSync(tmp, 'utf-8');
      expect(written).toContain(FAILURE_MARKER);
      expect(written).toContain('1/2 package(s) published');
      fs.unlinkSync(tmp);
    } finally {
      // Assigning undefined would coerce to the string "undefined" — delete instead.
      delete process.env.GITHUB_STEP_SUMMARY;
    }
  });
});

describe('resolveFailureReportIfPresent', () => {
  it('should flip an existing report to resolved', async () => {
    const existing = renderFailureReport({
      versionOutput,
      publishOutput: publishOutputFor([]),
      failedStage: 'npm-publish',
      errorMessage: 'err',
      recovery: { mode: 'standing-pr', standingPrNumber: 42 },
    });
    const forge = fakeForgeWith([{ id: 7, body: existing }]);
    await resolveFailureReportIfPresent(forge, 42, versionOutput);
    expect(forge.updatedComments).toHaveLength(1);
    const body = forge.updatedComments[0]?.body as string;
    expect(body).toContain('recovered');
  });

  it('should be a no-op when there is no existing report', async () => {
    const forge = fakeForgeWith([]);
    await resolveFailureReportIfPresent(forge, 42, versionOutput);
    expect(forge.updatedComments).toHaveLength(0);
    expect(forge.createdComments).toHaveLength(0);
  });
});

describe('detectUnresolvedFailure', () => {
  it('should detect an unresolved failure and recover the headline numbers', async () => {
    const report = renderFailureReport({
      versionOutput,
      publishOutput: publishOutputFor([
        { packageName: '@scope/a', version: '0.24.0', registry: 'npm', success: true, skipped: false },
        {
          packageName: '@scope/b',
          version: '0.24.0',
          registry: 'npm',
          success: false,
          skipped: false,
          reason: 'npm 403',
        },
      ]),
      failedStage: 'npm-publish',
      errorMessage: 'npm 403',
      recovery: { mode: 'standing-pr', standingPrNumber: 42 },
    });
    const forge = fakeForgeWith([{ id: 9, body: report }]);
    const result = await detectUnresolvedFailure(forge, 42);
    expect(result).toEqual({ previousLabel: 'v0.24.0', published: 1, total: 2, prNumber: 42 });
  });

  it('should return null once the report is resolved', async () => {
    const resolved = renderResolvedReport(versionOutput);
    const forge = fakeForgeWith([{ id: 9, body: resolved }]);
    expect(await detectUnresolvedFailure(forge, 42)).toBeNull();
  });

  it('should return null when there is no failure report', async () => {
    const forge = fakeForgeWith([{ id: 1, body: 'unrelated comment' }]);
    expect(await detectUnresolvedFailure(forge, 42)).toBeNull();
  });
});

describe('detectUnresolvedFailure env hygiene', () => {
  let savedSummary: string | undefined;
  beforeEach(() => {
    savedSummary = process.env.GITHUB_STEP_SUMMARY;
  });
  afterEach(() => {
    if (savedSummary === undefined) delete process.env.GITHUB_STEP_SUMMARY;
    else process.env.GITHUB_STEP_SUMMARY = savedSummary;
  });
  it('should act as a placeholder to anchor the env reset hooks', () => {
    expect(true).toBe(true);
  });
});
