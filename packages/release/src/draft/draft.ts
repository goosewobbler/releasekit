import type { VersionOutput } from '@releasekit/core';
import { hasUnterminatedNotesRegion, info, success, warn } from '@releasekit/core';
import { type Forge, isBotComment } from '@releasekit/forge';
import { createGitCli } from '@releasekit/git';
import { resolveFailureReportIfPresent } from '../failure-report/post.js';
import { requireGitHubContext } from '../git.js';
import { forgeFor } from '../github.js';
import { authorizePublish, DRAFT_LABEL, DRAFT_MANIFEST_MARKER } from '../publish-authorization.js';
import { runRelease } from '../release.js';
import { extractNotesRegions, renderedRegionText, renderNotesRegion } from '../standing-pr/notes-region.js';
import { parseManifest, type StandingPRManifest, serializeManifest } from '../standing-pr/standing-pr.js';
import { findTrustedComment, type TrustedCommentLookup } from '../trusted-comment.js';
import type { ReleaseOptions, ReleaseOutput } from '../types.js';
import { publishableUpdates, syncVersionDisplay } from '../version-display.js';

function nowIso(): string {
  return new Date().toISOString();
}

function findDraftManifestComment(forge: Forge, issueNumber: number): Promise<TrustedCommentLookup> {
  return findTrustedComment(forge, issueNumber, DRAFT_MANIFEST_MARKER, 'release-draft manifest');
}

export async function findReusableDraft(forge: Forge): Promise<number | undefined> {
  for (const issue of await forge.listOpenIssuesByLabel(DRAFT_LABEL)) {
    const { comment } = await findDraftManifestComment(forge, issue.number);
    if (comment && isReleaseManifestComment(comment.body)) {
      return issue.number;
    }
  }
  return undefined;
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
  const context = requireGitHubContext('a release draft cannot be created');
  // User-token prefixes; ghs_ (the GITHUB_TOKEN or an App installation token) passes. A user token in another format
  // is caught once the manifest is posted.
  if (/^(ghp|github_pat|gho|ghu)_/.test(context.token ?? '')) {
    throw new Error(
      "Cannot create a release draft with a personal token: '--from-draft' refuses a manifest a bot didn't post. " +
        "Run 'releasekit release --draft' with the workflow's GITHUB_TOKEN or a GitHub App installation token.",
    );
  }

  const result = await runRelease({ ...options, dryRun: true, skipGate: true });
  if (!result) {
    info('No releasable changes — no draft created.');
    return null;
  }

  const { versionOutput, releaseNotes } = result;
  const forge = forgeFor(context);
  const display = syncVersionDisplay(versionOutput);
  const title = display ? `Release draft: ${display}` : 'Release draft';

  // Never adopt a hand-labelled issue or a hand-written manifest.
  const reusable = await findReusableDraft(forge);
  if (options.dryRun) {
    info(
      reusable !== undefined
        ? `Dry run: would update release draft issue #${reusable} as "${title}".`
        : `Dry run: would open a new release draft issue "${title}".`,
    );
    return result;
  }

  const manifest: StandingPRManifest = {
    schemaVersion: 2,
    versionOutput,
    // The reviewed baseline: a package whose editable region gets mangled falls back to these, not fresh notes.
    releaseNotes: releaseNotes ?? {},
    notesFiles: [],
    createdAt: nowIso(),
    baseSha: await createGitCli().headSha(options.projectDir),
  };
  const body = renderDraftBody(versionOutput, releaseNotes ?? {});
  const manifestComment = serializeManifest(manifest, DRAFT_MANIFEST_MARKER);
  let issueNumber: number;
  if (reusable !== undefined) {
    await forge.updateIssue(reusable, { title, body });
    issueNumber = reusable;
  } else {
    const ref = await forge.createIssue({ title, body, labels: [DRAFT_LABEL] });
    issueNumber = ref.number;
  }
  const written = await forge.upsertMarkerComment(issueNumber, DRAFT_MANIFEST_MARKER, manifestComment);
  if (!isBotComment(written)) {
    throw new Error(
      `The release-draft manifest on issue #${issueNumber} was posted by '${written.user?.login ?? 'an unknown account'}', ` +
        "not a bot, so '--from-draft' would refuse it. Re-run 'releasekit release --draft' with the workflow's " +
        'GITHUB_TOKEN or a GitHub App installation token.',
    );
  }

  success(`Release draft ready for review: issue #${issueNumber}. Edit the notes, then dispatch --from-draft.`);
  return result;
}

export async function publishFromDraft(issueNumber: number, options: ReleaseOptions): Promise<ReleaseOutput | null> {
  const context = requireGitHubContext(`release draft #${issueNumber} cannot be published`);

  const forge = forgeFor(context);
  const { manifest } = await authorizePublish(forge, {
    phase: 'draft',
    issueNumber,
    cwd: options.projectDir,
    recomputePlan: async () =>
      (await runRelease({ ...options, dryRun: true, skipNotes: true, skipGate: true }))?.versionOutput,
    dryRun: options.dryRun,
  });

  // Re-read after the plan recompute so notes edited while it ran are published.
  const issue = await forge.getIssue(issueNumber);
  const draftedNotes = manifest.releaseNotes ?? {};
  const extracted = extractNotesRegions(issue.body, manifest.versionOutput);
  // An untouched region may hold the truncated render, so the full drafted text wins unless the region was edited.
  const edits = Object.fromEntries(
    Object.entries(extracted).filter(([key, text]) => text !== renderedRegionText(key, draftedNotes[key] ?? '')),
  );
  const editedNotes = { ...draftedNotes, ...edits };
  const droppedRegions = Object.keys(draftedNotes).filter(
    (pkg) => !Object.hasOwn(extracted, pkg) && !hasUnterminatedNotesRegion(issue.body, pkg),
  );
  if (droppedRegions.length > 0) {
    warn(
      `Could not read the edited notes region for ${droppedRegions.join(', ')} on draft #${issueNumber} ` +
        '(the markers may have been removed) — using the drafted notes for those packages.',
    );
  }
  if (Object.keys(editedNotes).length > 0) {
    info(`Applying reviewed notes for ${Object.keys(editedNotes).length} package(s) from draft #${issueNumber}.`);
  }

  const result = await runRelease({ ...options, dryRun: options.dryRun, editedNotes, skipGate: true });

  if (result && !options.dryRun && !options.skipPublish) {
    await resolveFailureReportIfPresent(forge, issueNumber, result.versionOutput);
    await forge.updateIssue(issueNumber, { state: 'closed' });
    success(`Published from draft #${issueNumber}; closed the draft issue.`);
  }
  return result;
}
