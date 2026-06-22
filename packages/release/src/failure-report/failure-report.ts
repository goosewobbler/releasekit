import type { VersionOutput } from '@releasekit/core';
import type { PublishOutput } from '@releasekit/publish';
import { ATTRIBUTION_FOOTER } from '../attribution.js';
import { publishableUpdates, syncVersionDisplay } from '../version-display.js';

/**
 * Distinct comment marker for the partial-publish failure report. Kept separate from the
 * preview (`<!-- releasekit-preview -->`) and gate-notify markers so the report manages its
 * own idempotent comment on the release-driving PR.
 */
export const FAILURE_MARKER = '<!-- releasekit-publish-failure -->';

/**
 * Machine-readable resolution status, encoded as an HTML comment immediately after the marker
 * so a later run (or the next standing-PR / preview) can detect whether the failure is still
 * outstanding without re-deriving it from a ledger. `unresolved` while a partial publish has
 * not been retried or superseded; `resolved` once a retry succeeds or a later release supersedes.
 */
export type FailureReportStatus = 'unresolved' | 'resolved';
const STATUS_PREFIX = '<!-- releasekit-publish-failure-status:';

/**
 * Machine-readable headline data (release label + published/total fraction), encoded as its own
 * HTML comment so the supersede warning can be rebuilt without parsing the human-facing report
 * copy — prose edits to the report must not silently break detection.
 */
const DATA_PREFIX = '<!-- releasekit-publish-failure-data:';

export interface FailureReportData {
  /** Release label of the partially-published release, e.g. `v0.24.0`. */
  label: string;
  published: number;
  total: number;
}

/** Release mode the failed publish ran in — drives the recovery instructions. */
export type FailureReportMode = 'standing-pr' | 'direct' | 'manual';

/** Per-package outcome in the publish ledger. */
export type LedgerStatus = 'published' | 'skipped' | 'failed' | 'not-attempted';

export interface LedgerEntry {
  packageName: string;
  version: string;
  status: LedgerStatus;
  /** Registry the result came from (npm/cargo), when known. */
  registry?: 'npm' | 'cargo';
  /** Human-readable detail — the skip reason or failure reason. */
  detail?: string;
}

const STATUS_ICON: Record<LedgerStatus, string> = {
  published: '✅',
  skipped: '⏭',
  failed: '❌',
  'not-attempted': '⏸',
};

const STATUS_LABEL: Record<LedgerStatus, string> = {
  published: 'published',
  skipped: 'skipped',
  failed: 'failed',
  'not-attempted': 'not attempted',
};

/**
 * Derive the per-package ledger from the version input and the partial publish output.
 *
 * The publish ledger (`PublishOutput.npm` / `.cargo`) only carries entries for packages the
 * pipeline reached before failing. "Not attempted" packages are derived by diffing the input
 * updates against the packages that appear in the ledger — a package the pipeline never got to
 * simply has no result entry.
 */
export function buildLedger(versionOutput: VersionOutput, publishOutput: PublishOutput | undefined): LedgerEntry[] {
  const updates = publishableUpdates(versionOutput);
  const results = [...(publishOutput?.npm ?? []), ...(publishOutput?.cargo ?? [])];

  // Index results by package name. A package may appear once (single registry) — when it appears
  // on multiple registries, prefer a failed/published entry over a skipped one so the headline
  // status reflects the most significant outcome.
  const byPackage = new Map<string, LedgerEntry>();
  for (const r of results) {
    let status: LedgerStatus;
    let detail: string | undefined;
    if (!r.success) {
      status = 'failed';
      detail = r.reason;
    } else if (r.skipped || r.alreadyPublished) {
      status = 'skipped';
      detail = r.alreadyPublished ? 'already published' : (r.reason ?? 'skipped');
    } else {
      status = 'published';
    }

    const existing = byPackage.get(r.packageName);
    const entry: LedgerEntry = {
      packageName: r.packageName,
      version: r.version,
      status,
      registry: r.registry,
      detail,
    };
    // Significance order: failed > published > skipped. Keep the more significant outcome.
    const significance: Record<LedgerStatus, number> = { failed: 3, published: 2, skipped: 1, 'not-attempted': 0 };
    if (!existing || significance[status] > significance[existing.status]) {
      byPackage.set(r.packageName, entry);
    }
  }

  return updates.map((u) => {
    const entry = byPackage.get(u.packageName);
    if (entry) return entry;
    return {
      packageName: u.packageName,
      version: u.newVersion,
      status: 'not-attempted' as const,
    };
  });
}

/** A short "2/4 packages on npm" style fraction for the headline and supersede warning. */
function publishedFraction(ledger: LedgerEntry[]): { published: number; total: number } {
  const published = ledger.filter((e) => e.status === 'published').length;
  return { published, total: ledger.length };
}

/**
 * Best-effort release label (e.g. `v0.24.0`) for the headline. Sync releases share a single
 * version; async/single fall back to a representative version.
 */
function releaseLabel(versionOutput: VersionOutput): string {
  if (versionOutput.strategy === 'sync') {
    const display = syncVersionDisplay(versionOutput);
    return display.startsWith('v') ? display : `v${display}`;
  }
  const first = publishableUpdates(versionOutput)[0];
  return first ? `v${first.newVersion}` : '';
}

export interface RecoveryContext {
  mode: FailureReportMode;
  /** Standing PR number (standing-pr mode) used to phrase the dispatch/retry instruction. */
  standingPrNumber?: number;
  /**
   * Whether the `release:retry` label flow is wired (issue #245). When set, the label is the
   * primary standing-pr recovery path; dispatch is offered as the manual fallback. Defaults off
   * for callers that have not opted in (e.g. tests asserting the pre-#245 copy).
   */
  retryLabelAvailable?: boolean;
}

function renderRecovery(ctx: RecoveryContext): string[] {
  const lines: string[] = ['### How to recover', ''];
  if (ctx.mode === 'standing-pr') {
    const prRef = ctx.standingPrNumber ? `#${ctx.standingPrNumber}` : 'the merged standing PR';
    lines.push(
      `Re-run the publish for ${prRef}. Versions are already on \`main\`; retrying re-publishes only the packages that did not land.`,
      '',
    );
    if (ctx.retryLabelAvailable) {
      // The label is the primary recovery path — it dispatches the manifest-driven publish for
      // this PR and removes itself, so it can be re-applied for another retry.
      lines.push(
        `- **Add the \`release:retry\` label** to ${prRef} to retry the publish automatically. The label is removed after each retry, so re-apply it to retry again.`,
        `- Or **dispatch the release workflow** targeting the merged standing PR (\`--pr ${ctx.standingPrNumber ?? '<number>'}\`).`,
      );
    } else {
      lines.push(
        `- **Dispatch the release workflow** targeting the merged standing PR (\`--pr ${ctx.standingPrNumber ?? '<number>'}\`).`,
      );
    }
  } else if (ctx.mode === 'direct') {
    lines.push(
      'Use GitHub’s **"Re-run failed jobs"** on the failed workflow run. Versions are already on `main`; the re-run re-publishes only the packages that did not land.',
    );
  } else {
    lines.push(
      'Re-run the release workflow (manual dispatch). Versions are already on `main`; the re-run re-publishes only the packages that did not land.',
    );
  }
  return lines;
}

const SAFE_RETRY_NOTE =
  '> **Retrying is safe.** The publish path skips versions that are already on the registry, and tags / GitHub releases are only created after the publish succeeds — so a partial failure never leaves a half-created release to clean up.';

export interface FailureReportInput {
  versionOutput: VersionOutput;
  publishOutput: PublishOutput | undefined;
  /** Stage that failed (e.g. `npm-publish`, `verify`). */
  failedStage: string;
  /** Error message from the pipeline failure. */
  errorMessage: string;
  recovery: RecoveryContext;
}

/**
 * Render the partial-publish failure report comment body (marker-keyed, idempotent).
 * The status line encodes `unresolved` so the next standing PR / preview can detect the
 * outstanding failure and surface the supersede warning.
 */
export function renderFailureReport(input: FailureReportInput): string {
  const { versionOutput, publishOutput, failedStage, errorMessage, recovery } = input;
  const ledger = buildLedger(versionOutput, publishOutput);
  const { published, total } = publishedFraction(ledger);
  const label = releaseLabel(versionOutput);

  const lines: string[] = [
    FAILURE_MARKER,
    `${STATUS_PREFIX} unresolved -->`,
    `${DATA_PREFIX} ${JSON.stringify({ label, published, total } satisfies FailureReportData)} -->`,
    '',
    `## ❌ Publish of ${label} failed partway through`,
    '',
    `**${published}/${total} package(s) published.** Versions are already committed on \`main\` (roll-forward model) and no tags or GitHub releases were created. The release is not finished.`,
    '',
    '### Package ledger',
    '',
    '| Package | Version | Status | Detail |',
    '|---------|---------|--------|--------|',
  ];

  for (const e of ledger) {
    const status = `${STATUS_ICON[e.status]} ${STATUS_LABEL[e.status]}`;
    const detail = e.detail ?? '';
    lines.push(`| \`${e.packageName}\` | ${e.version} | ${status} | ${detail} |`);
  }

  lines.push(
    '',
    '### What failed',
    '',
    `Stage **\`${failedStage}\`** failed:`,
    '',
    '```',
    errorMessage,
    '```',
    '',
    ...renderRecovery(recovery),
    '',
    SAFE_RETRY_NOTE,
    '',
    '---',
    ATTRIBUTION_FOOTER,
  );

  return lines.join('\n');
}

/**
 * Render the resolved variant of the report — produced when a later publish for the same
 * release succeeds (retry or supersede). Keeps the marker so it updates the same comment, and
 * encodes `resolved` so the supersede warning clears.
 */
export function renderResolvedReport(versionOutput: VersionOutput): string {
  const label = releaseLabel(versionOutput);
  return [
    FAILURE_MARKER,
    `${STATUS_PREFIX} resolved -->`,
    '',
    `## ✅ Publish of ${label} recovered`,
    '',
    'A later publish run completed successfully, so this release is now fully published. No further action is needed.',
    '',
    '---',
    ATTRIBUTION_FOOTER,
  ].join('\n');
}

/**
 * Read the encoded resolution status from a failure-report comment body. Returns null when the
 * body is not a failure report (no marker). Bodies written before the status line existed are
 * treated as `unresolved` (the conservative default — surface the warning rather than hide it).
 */
export function parseFailureReportStatus(body: string): FailureReportStatus | null {
  if (!body.startsWith(FAILURE_MARKER)) return null;
  const match = body.match(/<!-- releasekit-publish-failure-status:\s*(unresolved|resolved)\s*-->/);
  return (match?.[1] as FailureReportStatus | undefined) ?? 'unresolved';
}

/**
 * Read the encoded headline data from a failure-report comment body. Returns null when the body
 * is not a failure report or the data comment is missing/malformed.
 */
export function parseFailureReportData(body: string): FailureReportData | null {
  if (!body.startsWith(FAILURE_MARKER)) return null;
  // Locate the data block by its fixed delimiters with linear indexOf rather than a backtracking
  // regex — a regex like `:\s*(\{.*?\})\s*-->` is polynomial on an untrusted comment body with many
  // `{` and no terminator (ReDoS). JSON.parse + the field checks below still reject anything malformed.
  const prefix = '<!-- releasekit-publish-failure-data:';
  const start = body.indexOf(prefix);
  if (start === -1) return null;
  const end = body.indexOf('-->', start + prefix.length);
  if (end === -1) return null;
  try {
    const parsed = JSON.parse(body.slice(start + prefix.length, end).trim()) as Partial<FailureReportData>;
    if (typeof parsed.label !== 'string' || typeof parsed.published !== 'number' || typeof parsed.total !== 'number') {
      return null;
    }
    return { label: parsed.label, published: parsed.published, total: parsed.total };
  } catch {
    return null;
  }
}

export interface SupersedeWarningInput {
  /** Release label of the partially-published prior release, e.g. `v0.24.0`. */
  previousLabel: string;
  published: number;
  total: number;
  /** Standing PR number carrying the failure report (the retry surface). */
  standingPrNumber?: number;
  /** Whether the `release:retry` label flow is wired (issue #245) — makes it the primary hint. */
  retryLabelAvailable?: boolean;
}

/**
 * Render the warning block shown on the NEXT standing PR (and the release preview) while a
 * prior release remains partially published. Gives the maintainer the honest retry-vs-supersede
 * choice described in the issue.
 */
export function renderSupersedeWarning(input: SupersedeWarningInput): string[] {
  const { previousLabel, published, total, standingPrNumber, retryLabelAvailable } = input;
  const prRef = standingPrNumber ? `the merged standing PR (#${standingPrNumber})` : 'the merged standing PR';
  const retryHint = retryLabelAvailable
    ? `Retry it via \`release:retry\` on ${prRef}`
    : `Retry it by dispatching the release workflow against ${prRef}`;
  return [
    `> ⚠️ **Previous release ${previousLabel} is partially published** (${published}/${total} packages on the registry; no tags/GitHub release created).`,
    `> ${retryHint}, **or** merging this PR supersedes it — the next release re-publishes everything at the new version.`,
    '',
  ];
}
