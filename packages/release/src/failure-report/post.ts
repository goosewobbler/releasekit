import * as fs from 'node:fs';
import type { VersionOutput } from '@releasekit/core';
import { info, warn } from '@releasekit/core';
import type { Forge } from '@releasekit/forge';
import type { PipelineError } from '@releasekit/publish';
import { findPreviewComment, postOrUpdateComment } from '../github.js';
import {
  FAILURE_MARKER,
  type FailureReportMode,
  parseFailureReportData,
  parseFailureReportStatus,
  renderFailureReport,
  renderResolvedReport,
} from './failure-report.js';

export interface PostFailureReportContext {
  forge: Forge;
  mode: FailureReportMode;
  /** Omitted with no PR (manual dispatch): the report goes to the step summary. */
  prNumber?: number;
  standingPrNumber?: number;
  retryLabelAvailable?: boolean;
}

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
    await postOrUpdateComment(ctx.forge, ctx.prNumber, body, FAILURE_MARKER);
    info(`Posted publish-failure report on PR #${ctx.prNumber}`);
  } catch (err) {
    warn(`Failed to post publish-failure report: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function resolveFailureReportIfPresent(
  forge: Forge,
  prNumber: number,
  versionOutput: VersionOutput,
): Promise<void> {
  try {
    const existing = await findPreviewComment(forge, prNumber, FAILURE_MARKER);
    if (existing === null) {
      return;
    }
    await postOrUpdateComment(forge, prNumber, renderResolvedReport(versionOutput), FAILURE_MARKER);
    info(`Marked publish-failure report on PR #${prNumber} as resolved`);
  } catch (err) {
    warn(`Failed to resolve publish-failure report: ${err instanceof Error ? err.message : String(err)}`);
  }
}

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
  previousLabel: string;
  published: number;
  total: number;
  prNumber: number;
}

export async function detectUnresolvedFailure(forge: Forge, prNumber: number): Promise<UnresolvedFailure | null> {
  let body: string | undefined;
  try {
    body = (await forge.findComment(prNumber, FAILURE_MARKER))?.body;
  } catch {
    return null;
  }

  if (!body) {
    return null;
  }
  if (parseFailureReportStatus(body) !== 'unresolved') {
    return null;
  }

  return parseReportLedgerSummary(body, prNumber);
}

function parseReportLedgerSummary(body: string, prNumber: number): UnresolvedFailure | null {
  const data = parseFailureReportData(body);
  if (!data) {
    return null;
  }
  return {
    previousLabel: data.label,
    published: data.published,
    total: data.total,
    prNumber,
  };
}
