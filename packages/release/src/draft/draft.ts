import type { VersionOutput } from '@releasekit/core';
import { info, success, warn } from '@releasekit/core';
import { createGitCli } from '@releasekit/git';
import { getGitHubContext } from '../git.js';
import { forgeFor } from '../github.js';
import { runRelease } from '../release.js';
import { extractNotesRegions, renderNotesRegion } from '../standing-pr/notes-region.js';
import {
  MANIFEST_MARKER,
  parseManifest,
  type StandingPRManifest,
  serializeManifest,
} from '../standing-pr/standing-pr.js';
import type { ReleaseOptions, ReleaseOutput } from '../types.js';
import { publishableUpdates, syncVersionDisplay } from '../version-display.js';

/**
 * Label that marks the manual-mode release-draft tracking issue. Keyed on so re-running `--draft`
 * reuses the one open draft issue instead of stacking new ones (the marker-idempotency invariant,
 * applied to an issue rather than a comment).
 */
export const DRAFT_LABEL = 'release:draft';

/** ISO timestamp via an injectable clock so the manifest's `createdAt` stays deterministic in tests. */
function nowIso(): string {
  return new Date().toISOString();
}

/** Whether two version outputs name the same publishable packages at the same versions. */
function samePlan(a: VersionOutput | undefined, b: VersionOutput): boolean {
  if (!a) return false;
  const key = (v: VersionOutput) =>
    publishableUpdates(v)
      .map((u) => `${u.packageName}@${u.newVersion}`)
      .sort()
      .join(',');
  return key(a) === key(b);
}

/** The human-facing tracking-issue body: a how-to preamble plus the editable per-package notes. */
function renderDraftBody(versionOutput: VersionOutput, releaseNotes: Record<string, string>): string {
  const updates = publishableUpdates(versionOutput);
  const planLines = updates.map((u) => `- \`${u.packageName}\` → ${u.newVersion}`);
  const preamble = [
    '## Release Draft',
    '',
    'This issue holds a computed release awaiting review. **Edit the release notes below**, then',
    "dispatch the publish (`releasekit release --from-draft <this issue's number>`) to publish exactly",
    'this release with your edits.',
    '',
    'The release plan:',
    '',
    ...planLines,
    '',
    'Do not edit the hidden manifest comment — it carries the machine-readable release plan the',
    'dispatch reads back. The draft is pinned to the commit it was computed at; if `main` moves before',
    'you dispatch, re-run `--draft` to refresh it.',
    '',
  ].join('\n');
  const notesRegion = renderNotesRegion(releaseNotes);
  return notesRegion ? `${preamble}\n${notesRegion}` : preamble;
}

/**
 * Phase 1 of manual-mode draft-then-dispatch (#319). Computes the release without mutating the tree
 * or publishing (a dry-run pass), then opens — or updates in place — a tracking issue holding the
 * editable per-package notes in its body and the base64 manifest in a marker comment. A human edits
 * the notes; {@link publishFromDraft} consumes them.
 */
export async function runReleaseDraft(options: ReleaseOptions): Promise<ReleaseOutput | null> {
  const context = getGitHubContext();
  if (!context?.token) {
    throw new Error('Cannot create a release draft: no GitHub token in the environment.');
  }

  // Dry-run pass: compute versionOutput + notes, write nothing to disk, publish nothing.
  const result = await runRelease({ ...options, dryRun: true });
  if (!result) {
    info('No releasable changes — no draft created.');
    return null;
  }

  const { versionOutput, releaseNotes } = result;
  const baseSha = await createGitCli().headSha(options.projectDir);
  const manifest: StandingPRManifest = {
    schemaVersion: 2,
    versionOutput,
    // Store the drafted notes alongside the editable copy in the issue body. The draft is pinned to
    // baseSha (no drift), so these are the reviewed baseline: at dispatch they back-stop any package
    // whose editable region was removed/mangled, so a lost marker degrades to the reviewed notes
    // rather than silently regenerating different ones (#463 review).
    releaseNotes: releaseNotes ?? {},
    notesFiles: [],
    createdAt: nowIso(),
    baseSha,
  };

  const forge = forgeFor(context);
  const display = syncVersionDisplay(versionOutput);
  const title = display ? `Release draft: ${display}` : 'Release draft';
  const body = renderDraftBody(versionOutput, releaseNotes ?? {});
  const manifestComment = serializeManifest(manifest);

  // Reuse the existing draft only if it's actually ours — an open issue carrying the label AND a
  // release manifest comment. A human-labelled, unrelated issue must not have its title/body
  // overwritten with a release draft (#463 review); fall through to creating a fresh draft instead.
  const existing = await forge.findOpenIssueByLabel(DRAFT_LABEL);
  const reusable = existing && (await forge.findComment(existing.number, MANIFEST_MARKER)) ? existing : null;
  let issueNumber: number;
  if (reusable) {
    await forge.updateIssue(reusable.number, { title, body });
    issueNumber = reusable.number;
  } else {
    const ref = await forge.createIssue({ title, body, labels: [DRAFT_LABEL] });
    issueNumber = ref.number;
  }
  // Idempotent: updates the manifest comment in place on a re-draft, creates it on a fresh issue.
  await forge.upsertMarkerComment(issueNumber, MANIFEST_MARKER, manifestComment);

  success(`Release draft ready for review: issue #${issueNumber}. Edit the notes, then dispatch --from-draft.`);
  return result;
}

/**
 * Phase 2 of manual-mode draft-then-dispatch (#319). Reads the manifest + human-edited notes from the
 * draft issue, recomputes the release against HEAD (identical to the drafted plan because the baseSha
 * guard requires HEAD to match), applies the edited notes (edited wins per package), publishes, and
 * closes the issue on success.
 */
export async function publishFromDraft(issueNumber: number, options: ReleaseOptions): Promise<ReleaseOutput | null> {
  const context = getGitHubContext();
  if (!context?.token) {
    throw new Error('Cannot publish from a release draft: no GitHub token in the environment.');
  }

  const forge = forgeFor(context);
  const manifestComment = await forge.findComment(issueNumber, MANIFEST_MARKER);
  if (!manifestComment) {
    throw new Error(`No release-draft manifest found on issue #${issueNumber}.`);
  }
  const manifest = parseManifest(manifestComment.body);

  // Pin to the commit the draft was computed at: recomputing on a different HEAD could publish a
  // different version/notes than the human reviewed. Refuse and ask for a re-draft instead.
  const currentSha = await createGitCli().headSha(options.projectDir);
  if (currentSha !== manifest.baseSha) {
    throw new Error(
      `Release draft #${issueNumber} was computed at ${manifest.baseSha} but HEAD is ${currentSha}. ` +
        "Re-run 'releasekit release --draft' to refresh the draft, then dispatch again.",
    );
  }

  // baseSha pins the commit, but not the CLI flags: a dispatch run with different --target / --scope /
  // --bump (or drifted config) would recompute a different plan than the reviewed draft. Recompute the
  // plan (dry-run, no notes) and refuse if it no longer matches the manifest, so we never publish a
  // plan the human didn't review (#463 review).
  const preview = await runRelease({ ...options, dryRun: true, skipNotes: true });
  if (!samePlan(preview?.versionOutput, manifest.versionOutput)) {
    throw new Error(
      `The release plan recomputed at dispatch differs from the reviewed draft #${issueNumber}. ` +
        "Re-run 'releasekit release --draft' to refresh the draft, then dispatch with the same flags.",
    );
  }

  const issue = await forge.getIssue(issueNumber);
  const draftedNotes = manifest.releaseNotes ?? {};
  const extracted = extractNotesRegions(
    issue.body,
    publishableUpdates(manifest.versionOutput).map((u) => u.packageName),
  );
  // Reviewed notes win: edits read back from the body override the drafted baseline; any package
  // whose editable region went missing (markers removed/mangled) falls back to the drafted notes
  // rather than fresh regeneration, and is flagged (#463 review).
  const editedNotes = { ...draftedNotes, ...extracted };
  const droppedRegions = Object.keys(draftedNotes).filter((pkg) => !(pkg in extracted));
  if (droppedRegions.length > 0) {
    warn(
      `Could not read the edited notes region for ${droppedRegions.join(', ')} on draft #${issueNumber} ` +
        '(the markers may have been removed) — using the drafted notes for those packages.',
    );
  }
  if (Object.keys(editedNotes).length > 0) {
    info(`Applying reviewed notes for ${Object.keys(editedNotes).length} package(s) from draft #${issueNumber}.`);
  }

  // Respect --dry-run: a dry dispatch validates without publishing or closing the issue (#463 review).
  const result = await runRelease({ ...options, dryRun: options.dryRun, editedNotes });

  // Close the draft only after a real publish landed — never on a dry run or a --skip-publish run,
  // which compute without publishing anything (#463 review).
  if (result && !options.dryRun && !options.skipPublish) {
    await forge.updateIssue(issueNumber, { state: 'closed' });
    success(`Published from draft #${issueNumber}; closed the draft issue.`);
  }
  return result;
}
