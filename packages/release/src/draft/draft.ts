import type { VersionOutput } from '@releasekit/core';
import { info, success } from '@releasekit/core';
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
    // Notes live (editable) in the issue body, not the manifest — the dispatch reads edits from the
    // body and regenerates the rest, mirroring the standing-PR manifest's empty-releaseNotes contract.
    releaseNotes: {},
    notesFiles: [],
    createdAt: nowIso(),
    baseSha,
  };

  const forge = forgeFor(context);
  const display = syncVersionDisplay(versionOutput);
  const title = display ? `Release draft: ${display}` : 'Release draft';
  const body = renderDraftBody(versionOutput, releaseNotes ?? {});
  const manifestComment = serializeManifest(manifest);

  const existing = await forge.findOpenIssueByLabel(DRAFT_LABEL);
  let issueNumber: number;
  if (existing) {
    await forge.updateIssue(existing.number, { title, body });
    issueNumber = existing.number;
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

  const issue = await forge.getIssue(issueNumber);
  const editedNotes = extractNotesRegions(
    issue.body,
    publishableUpdates(manifest.versionOutput).map((u) => u.packageName),
  );
  if (Object.keys(editedNotes).length > 0) {
    info(`Found human-edited notes for ${Object.keys(editedNotes).length} package(s) on draft #${issueNumber}.`);
  }

  const result = await runRelease({ ...options, dryRun: false, editedNotes });

  // Close the draft only after a real publish — a no-op run (e.g. nothing to release) leaves it open.
  if (result) {
    await forge.updateIssue(issueNumber, { state: 'closed' });
    success(`Published from draft #${issueNumber}; closed the draft issue.`);
  }
  return result;
}
