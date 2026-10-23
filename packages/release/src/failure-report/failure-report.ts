import { markerData, type VersionOutput } from '@releasekit/core';
import type { PublishOutput, PublishResult } from '@releasekit/publish';
import { ATTRIBUTION_FOOTER } from '../attribution.js';
import { publishableUpdates, syncVersionDisplay } from '../version-display.js';

export const FAILURE_MARKER = '<!-- releasekit-publish-failure -->';

/** Lets a later run detect an outstanding failure without re-deriving it from a ledger. */
export type FailureReportStatus = 'unresolved' | 'resolved';
const STATUS_PREFIX = '<!-- releasekit-publish-failure-status:';

/** Its own marker so the supersede warning is rebuilt without parsing the report's prose. */
const DATA_PREFIX = '<!-- releasekit-publish-failure-data:';

export interface FailureReportData {
  label: string;
  published: number;
  total: number;
}

const STATUS_FIELD = markerData<FailureReportStatus>({
  open: STATUS_PREFIX,
  serialize: (status) => status,
  deserialize: (payload) => (payload === 'resolved' || payload === 'unresolved' ? payload : null),
});

const DATA_FIELD = markerData<FailureReportData>({
  open: DATA_PREFIX,
  serialize: (data) => JSON.stringify(data),
  deserialize: (payload) => {
    try {
      const parsed = JSON.parse(payload) as Partial<FailureReportData>;
      if (
        typeof parsed.label !== 'string' ||
        typeof parsed.published !== 'number' ||
        typeof parsed.total !== 'number'
      ) {
        return null;
      }
      return { label: parsed.label, published: parsed.published, total: parsed.total };
    } catch {
      return null;
    }
  },
});

export type FailureReportMode = 'standing-pr' | 'direct' | 'manual';

export type LedgerStatus = 'published' | 'skipped' | 'failed' | 'not-attempted';

export interface LedgerEntry {
  packageName: string;
  version: string;
  status: LedgerStatus;
  registry?: PublishResult['registry'];
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

/** The publish output only has entries for packages the pipeline reached; any other update is `not-attempted`. */
export function buildLedger(versionOutput: VersionOutput, publishOutput: PublishOutput | undefined): LedgerEntry[] {
  const updates = publishableUpdates(versionOutput);
  const results = [...(publishOutput?.npm ?? []), ...(publishOutput?.cargo ?? []), ...(publishOutput?.pub ?? [])];

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

    const existing = byPackage.get(r.updatePackageName);
    const entry: LedgerEntry = {
      packageName: r.updatePackageName,
      version: r.version,
      status,
      registry: r.registry,
      detail,
    };
    // A package on several registries keeps its most significant outcome.
    const significance: Record<LedgerStatus, number> = { failed: 3, published: 2, skipped: 1, 'not-attempted': 0 };
    if (!existing || significance[status] > significance[existing.status]) {
      byPackage.set(r.updatePackageName, entry);
    }
  }

  return updates.map((u) => {
    const entry = byPackage.get(u.packageName);
    if (entry) {
      return entry;
    }
    return {
      packageName: u.packageName,
      version: u.newVersion,
      status: 'not-attempted' as const,
    };
  });
}

function publishedFraction(ledger: LedgerEntry[]): { published: number; total: number } {
  const published = ledger.filter((e) => e.status === 'published').length;
  return { published, total: ledger.length };
}

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
  standingPrNumber?: number;
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
  failedStage: string;
  errorMessage: string;
  recovery: RecoveryContext;
}

export function renderFailureReport(input: FailureReportInput): string {
  const { versionOutput, publishOutput, failedStage, errorMessage, recovery } = input;
  const ledger = buildLedger(versionOutput, publishOutput);
  const { published, total } = publishedFraction(ledger);
  const label = releaseLabel(versionOutput);

  const lines: string[] = [
    FAILURE_MARKER,
    STATUS_FIELD.encode('unresolved'),
    DATA_FIELD.encode({ label, published, total }),
    '',
    `## ❌ Release of ${label} did not complete`,
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

export function renderResolvedReport(versionOutput: VersionOutput): string {
  const label = releaseLabel(versionOutput);
  return [
    FAILURE_MARKER,
    STATUS_FIELD.encode('resolved'),
    '',
    `## ✅ Release of ${label} recovered`,
    '',
    'A later publish run completed successfully, so this release is now fully published. No further action is needed.',
    '',
    '---',
    ATTRIBUTION_FOOTER,
  ].join('\n');
}

/** A report predating the status line reads as `unresolved`: surface the warning rather than hide it. */
export function parseFailureReportStatus(body: string): FailureReportStatus | null {
  if (!body.startsWith(FAILURE_MARKER)) {
    return null;
  }
  return STATUS_FIELD.decode(body) ?? 'unresolved';
}

export function parseFailureReportData(body: string): FailureReportData | null {
  if (!body.startsWith(FAILURE_MARKER)) {
    return null;
  }
  return DATA_FIELD.decode(body);
}

export interface SupersedeWarningInput {
  previousLabel: string;
  published: number;
  total: number;
  standingPrNumber?: number;
  retryLabelAvailable?: boolean;
}

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
