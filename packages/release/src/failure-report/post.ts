import * as fs from 'node:fs';
import type { VersionOutput } from '@releasekit/core';
import { info, warn } from '@releasekit/core';
import type { PipelineError } from '@releasekit/publish';
import type { createOctokit } from '../github.js';
import { findPreviewComment, postOrUpdateComment } from '../github.js';
import {
  FAILURE_MARKER,
  type FailureReportMode,
  parseFailureReportData,
  parseFailureReportStatus,
  renderFailureReport,
  renderResolvedReport,
} from './failure-report.js';

type OctokitInstance = ReturnType<typeof createOctokit>;

export interface PostFailureReportContext {
  octokit: OctokitInstance;
  owner: string;
  repo: string;
  mode: FailureReportMode;
  /** PR to comment on. Omit for manual dispatch with no PR — the report goes to the step summary. */
  prNumber?: number;
  standingPrNumber?: number;
  retryLabelAvailable?: boolean;
}

/**
 * Post (or update) the partial-publish failure report. When a PR number is available the report
 * is a marker-keyed comment (idempotent — a repeat failure updates the same comment). With no PR
 * (manual dispatch) it is appended to the workflow step summary at `$GITHUB_STEP_SUMMARY`.
 */
export async function postFailureReport(
  ctx: PostFailureReportContext,
  versionOutput: VersionOutput,
  error: PipelineError,
): Promise<void> {
  const body = renderFailureReport({
    versionOutput,
    publishOutput: error.partialOutput,
    failedStage: error.failedStage,
    errorMessage: error.message,
    recovery: {
      mode: ctx.mode,
      standingPrNumber: ctx.standingPrNumber,
      retryLabelAvailable: ctx.retryLabelAvailable,
    },
  });

  if (ctx.prNumber === undefined) {
    writeStepSummary(body);
    return;
  }

  try {
    await postOrUpdateComment(ctx.octokit, ctx.owner, ctx.repo, ctx.prNumber, body, FAILURE_MARKER);
    info(`Posted publish-failure report on PR #${ctx.prNumber}`);
  } catch (err) {
    warn(`Failed to post publish-failure report: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * On a successful publish, flip any existing failure report for this release to resolved. This
 * also clears the supersede warning on the next standing PR / preview. No-op when no report
 * exists. Safe to call unconditionally after a successful publish.
 */
export async function resolveFailureReportIfPresent(
  octokit: OctokitInstance,
  owner: string,
  repo: string,
  prNumber: number,
  versionOutput: VersionOutput,
): Promise<void> {
  try {
    const existing = await findPreviewComment(octokit, owner, repo, prNumber, FAILURE_MARKER);
    if (existing === null) return;
    await postOrUpdateComment(octokit, owner, repo, prNumber, renderResolvedReport(versionOutput), FAILURE_MARKER);
    info(`Marked publish-failure report on PR #${prNumber} as resolved`);
  } catch (err) {
    warn(`Failed to resolve publish-failure report: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Append a block to the GitHub Actions step summary file, when configured. */
export function writeStepSummary(body: string): void {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) {
    warn('No PR context and no $GITHUB_STEP_SUMMARY — publish-failure report not surfaced');
    return;
  }
  try {
    fs.appendFileSync(summaryPath, `${body}\n`);
    info('Wrote publish-failure report to the workflow step summary');
  } catch (err) {
    warn(`Failed to write step summary: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export interface UnresolvedFailure {
  /** Release label of the partially-published prior release, e.g. `v0.24.0`. */
  previousLabel: string;
  published: number;
  total: number;
  /** PR number carrying the failure report (the retry surface). */
  prNumber: number;
}

/**
 * Detect an unresolved partial-publish failure on a given PR by locating the failure-report
 * comment (marker) and reading its encoded resolution status. Returns null when there is no
 * report or it is already resolved. The published/total fraction is recovered from the ledger
 * embedded in the report body so the caller doesn't need the original pipeline output.
 */
export async function detectUnresolvedFailure(
  octokit: OctokitInstance,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<UnresolvedFailure | null> {
  let body: string | undefined;
  try {
    const iterator = octokit.paginate.iterator(octokit.rest.issues.listComments, {
      owner,
      repo,
      issue_number: prNumber,
      per_page: 100,
    });
    for await (const response of iterator) {
      for (const comment of response.data) {
        if (comment.body?.startsWith(FAILURE_MARKER)) {
          body = comment.body;
          break;
        }
      }
      if (body) break;
    }
  } catch {
    return null;
  }

  if (!body) return null;
  if (parseFailureReportStatus(body) !== 'unresolved') return null;

  return parseReportLedgerSummary(body, prNumber);
}

/**
 * Recover the headline numbers from a rendered failure report so the supersede warning can be
 * rebuilt without the original pipeline output. Reads the machine-readable data comment the
 * report embeds — never the human-facing copy, which is free to change.
 */
function parseReportLedgerSummary(body: string, prNumber: number): UnresolvedFailure | null {
  const data = parseFailureReportData(body);
  if (!data) return null;
  return {
    previousLabel: data.label,
    published: data.published,
    total: data.total,
    prNumber,
  };
}
