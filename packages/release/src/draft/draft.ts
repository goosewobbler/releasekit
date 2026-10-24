import type { VersionOutput } from '@releasekit/core';
import { info, success, warn } from '@releasekit/core';
import { createGitCli } from '@releasekit/git';
import { getGitHubContext } from '../git.js';
import { forgeFor } from '../github.js';
import { runRelease } from '../release.js';
import { extractNotesRegions, renderedRegionText, renderNotesRegion } from '../standing-pr/notes-region.js';
import {
  MANIFEST_MARKER,
  parseManifest,
  type StandingPRManifest,
  serializeManifest,
} from '../standing-pr/standing-pr.js';
import type { ReleaseOptions, ReleaseOutput } from '../types.js';
import { publishableUpdates, syncVersionDisplay } from '../version-display.js';

/** Keys the draft issue so re-running `--draft` reuses the open one instead of stacking new ones. */
export const DRAFT_LABEL = 'release:draft';

function nowIso(): string {
  return new Date().toISOString();
}

/** Order-independent arrays are sorted so a reordering alone never reads as drift. */
function planFingerprint(v: VersionOutput): string {
  const byName = <T extends { packageName: string }>(arr: readonly T[]) =>
    [...arr].sort((a, b) => a.packageName.localeCompare(b.packageName));
  return JSON.stringify({
    strategy: v.strategy ?? null,
    commitMessage: v.commitMessage ?? null,
    tags: [...v.tags].sort(),
    baselineTags: [...(v.baselineTags ?? [])].sort(),
    updates: byName(v.updates),
    changelogs: byName(v.changelogs),
    sharedEntries: v.sharedEntries ?? [],
  });
}

/**
 * The full plan, not just name@version: a recompute at the pinned baseSha can keep every version yet differ in tags,
 * commit message, the root update or changelogs (drifted flags or config).
 */
function samePlan(a: VersionOutput | undefined, b: VersionOutput): boolean {
  if (!a) {
    return false;
  }
  return planFingerprint(a) === planFingerprint(b);
}

function isReleaseManifestComment(body: string): boolean {
  try {
    parseManifest(body);
    return true;
  } catch {
    return false;
  }
}

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

/** Phase 1 of draft-then-dispatch: a human edits the issue's notes, then {@link publishFromDraft} consumes them. */
export async function runReleaseDraft(options: ReleaseOptions): Promise<ReleaseOutput | null> {
  const context = getGitHubContext();
  if (!context?.token) {
    throw new Error('Cannot create a release draft: no GitHub token in the environment.');
  }

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
    // The reviewed baseline: a package whose editable region gets mangled falls back to these, not fresh notes.
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

  // Only reuse an issue whose manifest comment really decodes: a hand-labelled unrelated issue must not be overwritten.
  const existing = await forge.findOpenIssueByLabel(DRAFT_LABEL);
  const existingManifest = existing ? await forge.findComment(existing.number, MANIFEST_MARKER) : undefined;
  const reusable = existing && existingManifest && isReleaseManifestComment(existingManifest.body) ? existing : null;
  let issueNumber: number;
  if (reusable) {
    await forge.updateIssue(reusable.number, { title, body });
    issueNumber = reusable.number;
  } else {
    const ref = await forge.createIssue({ title, body, labels: [DRAFT_LABEL] });
    issueNumber = ref.number;
  }
  await forge.upsertMarkerComment(issueNumber, MANIFEST_MARKER, manifestComment);

  success(`Release draft ready for review: issue #${issueNumber}. Edit the notes, then dispatch --from-draft.`);
  return result;
}

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

  // A different HEAD could publish something other than what was reviewed.
  const currentSha = await createGitCli().headSha(options.projectDir);
  if (currentSha !== manifest.baseSha) {
    throw new Error(
      `Release draft #${issueNumber} was computed at ${manifest.baseSha} but HEAD is ${currentSha}. ` +
        "Re-run 'releasekit release --draft' to refresh the draft, then dispatch again.",
    );
  }

  // baseSha pins the commit but not the CLI flags or config.
  const preview = await runRelease({ ...options, dryRun: true, skipNotes: true });
  if (!samePlan(preview?.versionOutput, manifest.versionOutput)) {
    throw new Error(
      `The release plan recomputed at dispatch differs from the reviewed draft #${issueNumber}. ` +
        "Re-run 'releasekit release --draft' to refresh the draft, then dispatch with the same flags.",
    );
  }

  const issue = await forge.getIssue(issueNumber);
  const draftedNotes = manifest.releaseNotes ?? {};
  const extracted = extractNotesRegions(issue.body, manifest.versionOutput);
  // An untouched region may hold the truncated render, so the full drafted text wins unless the region was edited.
  const edits = Object.fromEntries(
    Object.entries(extracted).filter(([key, text]) => text !== renderedRegionText(key, draftedNotes[key] ?? '')),
  );
  const editedNotes = { ...draftedNotes, ...edits };
  const droppedRegions = Object.keys(draftedNotes).filter((pkg) => !Object.hasOwn(extracted, pkg));
  if (droppedRegions.length > 0) {
    warn(
      `Could not read the edited notes region for ${droppedRegions.join(', ')} on draft #${issueNumber} ` +
        '(the markers may have been removed) — using the drafted notes for those packages.',
    );
  }
  if (Object.keys(editedNotes).length > 0) {
    info(`Applying reviewed notes for ${Object.keys(editedNotes).length} package(s) from draft #${issueNumber}.`);
  }

  const result = await runRelease({ ...options, dryRun: options.dryRun, editedNotes });

  if (result && !options.dryRun && !options.skipPublish) {
    await forge.updateIssue(issueNumber, { state: 'closed' });
    success(`Published from draft #${issueNumber}; closed the draft issue.`);
  }
  return result;
}
