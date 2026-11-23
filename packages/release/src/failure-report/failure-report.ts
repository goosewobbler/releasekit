import { escapeChangelogMentions, escapeCommentOpeners, markerData, type VersionOutput } from '@releasekit/core';
import type { PublishOutput, PublishResult } from '@releasekit/publish';
import { ATTRIBUTION_FOOTER } from '../attribution.js';
import type { PublishPhase } from '../publish-authorization.js';
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
  /** The publish refused the manifest before any tag or registry write. */
  refused?: boolean;
  /** A refusal whose cause can clear on its own, so a retry can succeed. */
  retryable?: boolean;
  /** Where the release was refused; unset for the merged standing PR's publish. */
  phase?: Exclude<PublishPhase, 'post-merge'>;
}

const REFUSAL_PHASES: ReadonlySet<string> = new Set(['pre-merge', 'draft', 'direct']);

const STATUS_FIELD = markerData<FailureReportStatus>({
  open: STATUS_PREFIX,
  serialize: (status) => status,
  deserialize: (payload) => (payload === 'resolved' || payload === 'unresolved' ? payload : null),
});

const DATA_FIELD = markerData<FailureReportData>({
  open: DATA_PREFIX,
  // `>` only occurs inside JSON strings, and escaping it keeps a forged label's `-->` from closing the marker.
  serialize: (data) => JSON.stringify(data).replaceAll('>', '\\u003e'),
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
      const data: FailureReportData = { label: parsed.label, published: parsed.published, total: parsed.total };
      if (parsed.refused === true) {
        data.refused = true;
      }
      if (parsed.retryable === true) {
        data.retryable = true;
      }
      if (typeof parsed.phase === 'string' && REFUSAL_PHASES.has(parsed.phase)) {
        data.phase = parsed.phase;
      }
      return data;
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
  /** A release tag is already on the remote at another commit, so a retry fails the same way. */
  alreadyReleased?: boolean;
}

const SAFE_RETRY_NOTE =
  '> **Retrying is safe.** Versions already on the registry are skipped. Do not delete a tag for a version that was published.';

function pushesPerPackage(versionOutput: VersionOutput): boolean {
  return versionOutput.updates.some((update) => !!update.tag);
}

function branchPushedWithoutTags(publishOutput: PublishOutput | undefined): string | undefined {
  return publishOutput?.git.pushed === true ? undefined : publishOutput?.git.branch;
}

function partialFailureState(
  mode: FailureReportMode,
  publishOutput: PublishOutput | undefined,
  failedStage: string,
): string {
  const pushed = publishOutput?.git.pushed === true;
  if (mode === 'standing-pr') {
    if (pushed) {
      return 'Versions are on `main` from the merge. This run pushed before it failed, so some tags may already be on the remote. GitHub releases are created only after every package succeeds.';
    }
    return 'Versions are on `main` from the merge. This run did not confirm a push.';
  }
  if (pushed) {
    return 'A push succeeded before the failure, so the release commit or some tags may already be on the remote.';
  }
  const branch = branchPushedWithoutTags(publishOutput);
  if (branch) {
    return `The release commit reached \`${branch}\`, but a tag push failed, so tags are missing and no GitHub Release was created.`;
  }
  if (failedStage === 'git-push' && publishOutput?.git.committed) {
    return 'The push stage failed before the branch was pushed, so the release commit and tags are not on the remote.';
  }
  return 'This run did not confirm a push, so the version commit and tags may exist only in the failed run. Packages that reached the registry stay published.';
}

/** Per-package mode pushes a tag only once its package publishes, so unpublished packages have none to restore. */
function tagsToRestore(versionOutput: VersionOutput, publishOutput: PublishOutput): string[] {
  if (!pushesPerPackage(versionOutput)) {
    return [...new Set(publishOutput.git.tags)];
  }
  const reached = new Set(
    buildLedger(versionOutput, publishOutput)
      .filter((entry) => entry.status === 'published' || entry.status === 'skipped')
      .map((entry) => entry.packageName),
  );
  const packageTags = versionOutput.updates.flatMap((update) =>
    update.tag && reached.has(update.packageName) ? [update.tag] : [],
  );
  // Baseline tags are pushed only at the end, so a failed per-package run never pushed them.
  return [...new Set([...packageTags, ...(versionOutput.baselineTags ?? [])])];
}

function renderRollForward(versionOutput: VersionOutput, publishOutput: PublishOutput): string[] {
  const lines = [
    "Roll forward with the next release. It bumps past this release, which gets no GitHub Release. Don't re-run the release: a re-run creates a second release commit that can't be pushed over the one already on the remote, so it fails every time.",
    '',
    "Restore the missing tags before the next release. Without them it counts from the previous tag, so its changelog repeats this release's entries and its bump counts this release's commits again. Under `mismatchStrategy: 'error'` it can also throw a version mismatch if this release moved onto or off a prerelease.",
  ];
  const tags = tagsToRestore(versionOutput, publishOutput);
  const sha = publishOutput.git.commitSha;
  const remote = publishOutput.git.remote ?? 'origin';
  if (sha && tags.length > 0) {
    lines.push(
      '',
      'Run these, skipping the `git tag` line for any tag that already exists:',
      '',
      '```sh',
      `git fetch ${remote}`,
      ...tags.map((tag) => `git tag ${tag} ${sha}`),
      ...tags.map((tag) => `git push ${remote} ${tag}`),
      '```',
    );
  }
  return lines;
}

function standingPrRetry(ctx: RecoveryContext): string[] {
  const prRef = ctx.standingPrNumber ? `#${ctx.standingPrNumber}` : 'the merged standing PR';
  const dispatch = `targeting the merged standing PR (\`--pr ${ctx.standingPrNumber ?? '<number>'}\`).`;
  const lines = [
    `Re-run the publish for ${prRef}. Versions are already on \`main\`; retrying re-publishes only the packages that did not land.`,
    '',
  ];
  if (ctx.retryLabelAvailable) {
    lines.push(
      `- **Add the \`release:retry\` label** to ${prRef} to retry the publish automatically. The label is removed after each retry, so re-apply it to retry again.`,
      `- Or **dispatch the release workflow** ${dispatch}`,
    );
  } else {
    lines.push(`- **Dispatch the release workflow** ${dispatch}`);
  }
  return lines;
}

function renderLedger(ledger: LedgerEntry[]): string[] {
  return [
    '### Package ledger',
    '',
    '| Package | Version | Status | Detail |',
    '|---------|---------|--------|--------|',
    ...ledger.map(
      (e) =>
        `| \`${e.packageName}\` | ${e.version} | ${STATUS_ICON[e.status]} ${STATUS_LABEL[e.status]} | ${e.detail ?? ''} |`,
    ),
  ];
}

function renderRecovery(
  ctx: RecoveryContext,
  versionOutput: VersionOutput,
  publishOutput: PublishOutput | undefined,
): string[] {
  const lines: string[] = ['### How to recover', ''];
  if (ctx.alreadyReleased) {
    lines.push(
      "Retrying won't help: the remote already has this release's tag at another commit, so that version was released before, and a retry fails the same way.",
      '',
      "Raise the version in `releasekit.versions.json` to at least the last released one (`git ls-remote --tags origin` lists the release tags), then release again. Don't delete or move the tags.",
    );
    return lines;
  }
  const pushed = publishOutput?.git.pushed === true;
  const perPackage = pushesPerPackage(versionOutput) && pushed;
  if (ctx.mode === 'standing-pr') {
    lines.push(...standingPrRetry(ctx));
  } else if (perPackage) {
    lines.push(
      'Roll forward with the next release. The release commit and tags for packages that published are already on the remote — do not delete them.',
    );
    return lines;
  } else if (publishOutput && branchPushedWithoutTags(publishOutput)) {
    lines.push(...renderRollForward(versionOutput, publishOutput));
    return lines;
  } else if (ctx.mode === 'direct') {
    lines.push(
      'Use GitHub’s **"Re-run failed jobs"** on the failed workflow run. The re-run skips versions already on the registry.',
    );
  } else {
    lines.push('Re-run the release workflow (manual dispatch). The re-run skips versions already on the registry.');
  }
  lines.push('', SAFE_RETRY_NOTE);
  return lines;
}

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
    // A collision published nothing and a retry fails the same way, so the next standing PR treats it as a refusal.
    DATA_FIELD.encode({ label, published, total, ...(recovery.alreadyReleased ? { refused: true } : {}) }),
    '',
    `## ❌ Release of ${label} did not complete`,
    '',
    `**${published}/${total} package(s) published.** ${partialFailureState(recovery.mode, publishOutput, failedStage)} The release is not finished.`,
    '',
    ...renderLedger(ledger),
    '',
    '### What failed',
    '',
    `Stage **\`${failedStage}\`** failed:`,
    '',
    '```',
    errorMessage,
    '```',
    '',
    ...renderRecovery(recovery, versionOutput, publishOutput),
    '',
    '---',
    ATTRIBUTION_FOOTER,
  ];

  return lines.join('\n');
}

export interface RefusalReportInput {
  phase: PublishPhase;
  /** A PR, or the draft's issue. */
  prNumber: number;
  /** Absent when the manifest couldn't be read or trusted. */
  versionOutput?: VersionOutput;
  reason: string;
  /** The cause can clear on its own, such as an unreachable API, so a retry can succeed. */
  retryable: boolean;
  retryLabelAvailable?: boolean;
}

function untrusted(text: string): string {
  return escapeChangelogMentions(escapeCommentOpeners(text));
}

function refusedState(phase: PublishPhase, prNumber: number, manifestRead: boolean): string {
  switch (phase) {
    case 'pre-merge':
      return manifestRead
        ? 'The merge was refused, so nothing was merged, tagged or published.'
        : `**Nothing was merged.** The release manifest on #${prNumber} could not be read or trusted, so the merge was refused.`;
    case 'draft':
      return manifestRead
        ? 'The publish refused the reviewed draft before creating any commit or tag or publishing anything.'
        : `**Nothing was published.** The release-draft manifest on #${prNumber} could not be read or trusted, so the publish stopped before creating any commit or tag or publishing anything.`;
    case 'direct':
      return `**Nothing was released.** The release from #${prNumber} stopped before versioning anything, so it created no commit or tag and published nothing.`;
    case 'post-merge':
      return manifestRead
        ? 'The publish refused the release manifest before creating any tag or publishing anything. The merge put the version bumps on `main`.'
        : `**Nothing was published.** The publish stopped before it could trust the release manifest on #${prNumber}, so it created no tag and published nothing.`;
  }
}

function refusalRecovery(input: RefusalReportInput): string[] {
  const { phase, prNumber, retryable } = input;
  switch (phase) {
    case 'pre-merge':
      return [
        "Run `releasekit standing-pr update` to regenerate the release manifest, then merge again. Don't merge this PR another way: its publish would refuse the same manifest.",
      ];
    case 'draft':
      return [
        'Run `releasekit release --draft` to refresh the draft, then dispatch `--from-draft` for the draft issue it reports, with the same flags.',
      ];
    case 'direct':
      return retryable
        ? ['Use GitHub’s **"Re-run failed jobs"** on the failed workflow run once the cause clears.']
        : [
            'No release commit was made, so the next release includes these changes. To release them now, have an actor with the required permission dispatch the release workflow, or set `ci.standingPr.authorization.enforceMergeAuthor: false`.',
          ];
    case 'post-merge':
      return retryable
        ? [
            ...standingPrRetry({
              mode: 'standing-pr',
              standingPrNumber: prNumber,
              retryLabelAvailable: input.retryLabelAvailable,
            }),
            '',
            SAFE_RETRY_NOTE,
          ]
        : [
            "Retrying won't help: a retry reads the same manifest and merged commit, so it is refused again.",
            '',
            "Merge the next standing PR instead. It supersedes this release: it skips this release's versions, bumps on top of them and repeats their changelog entries. Don't delete tags or revert the release commit.",
          ];
  }
}

export function renderRefusalReport(input: RefusalReportInput): string {
  const { phase, prNumber, versionOutput, reason, retryable } = input;
  const ledger = versionOutput ? buildLedger(versionOutput, undefined) : [];
  const label = versionOutput ? releaseLabel(versionOutput) : '';
  const data: FailureReportData = { label, published: 0, total: ledger.length, refused: true };
  if (retryable) {
    data.retryable = true;
  }
  if (phase !== 'post-merge') {
    data.phase = phase;
  }

  const lines: string[] = [FAILURE_MARKER, STATUS_FIELD.encode('unresolved'), DATA_FIELD.encode(data), ''];
  // The manifest was refused, so its names and versions may be forged.
  if (versionOutput) {
    lines.push(
      `## ❌ Release of ${untrusted(label)} was refused`,
      '',
      `**0/${ledger.length} package(s) published.** ${refusedState(phase, prNumber, true)}`,
      '',
      ...renderLedger(ledger).map(untrusted),
    );
  } else {
    lines.push(`## ❌ Release from #${prNumber} was refused`, '', refusedState(phase, prNumber, false));
  }
  // A fence longer than any backtick run in the reason, which quotes the manifest's tags and names.
  const fence = '`'.repeat(Math.max(2, ...(reason.match(/`+/g) ?? []).map((run) => run.length)) + 1);
  lines.push(
    '',
    '### Why it was refused',
    '',
    fence,
    escapeCommentOpeners(reason),
    fence,
    '',
    '### How to recover',
    '',
    ...refusalRecovery(input),
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
  refused?: boolean;
  retryable?: boolean;
  standingPrNumber?: number;
  retryLabelAvailable?: boolean;
}

export function renderSupersedeWarning(input: SupersedeWarningInput): string[] {
  const { previousLabel, published, total, refused, retryable, standingPrNumber, retryLabelAvailable } = input;
  const prRef = standingPrNumber ? `the merged standing PR (#${standingPrNumber})` : 'the merged standing PR';
  if (refused && !retryable) {
    const release = previousLabel ? `release ${untrusted(previousLabel)}` : 'the previous release';
    return [
      `> ⚠️ **The publish of ${release} from ${prRef} was refused**, so nothing was tagged or published. Retrying won't help: merging this PR supersedes it, and the next release skips those versions, bumps on top of them and repeats their changelog entries. Don't revert its release commit.`,
      '',
    ];
  }
  const retryHint = retryLabelAvailable
    ? `Retry it via \`release:retry\` on ${prRef}`
    : `Retry it by dispatching the release workflow against ${prRef}`;
  const state = refused
    ? 'was refused at publish** (nothing on the registry)'
    : `is partially published** (${published}/${total} packages on the registry)`;
  return [
    `> ⚠️ **Previous release ${untrusted(previousLabel)} ${state}.`,
    `> ${retryHint} to publish its versions, **or** merging this PR supersedes it: the next release skips the unpublished versions and bumps on top of them. Do not delete tags for versions that were published.`,
    '',
  ];
}
