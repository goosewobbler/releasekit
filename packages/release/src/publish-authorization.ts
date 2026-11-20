import * as path from 'node:path';
import type { CIConfig, ReleaseKitConfig } from '@releasekit/config';
import type { VersionOutput } from '@releasekit/core';
import { warn } from '@releasekit/core';
import type { Forge, PullRequestDetails } from '@releasekit/forge';
import { createGitCli } from '@releasekit/git';
import { postRefusalReport } from './failure-report/post.js';
import type { GateOutput } from './gate/gate.js';
import { isAuthorizedActor, type StandingPrAuthorization } from './standing-pr/authorization.js';
import {
  extractOverrideLabels,
  MANIFEST_MARKER,
  parseManifest,
  type StandingPRManifest,
} from './standing-pr/standing-pr.js';
import { findTrustedComment } from './trusted-comment.js';
import { publishableUpdates } from './version-display.js';

/**
 * Where a publish is asked for: merging the standing PR, publishing the merged standing PR (on merge, by retry or by
 * dispatch), publishing a reviewed release draft, or a direct release from the pushed commit.
 */
export type PublishPhase = 'pre-merge' | 'post-merge' | 'draft' | 'direct';

/** Keys the draft issue, so re-running `--draft` reuses the open one and `--from-draft` refuses any other issue. */
export const DRAFT_LABEL = 'release:draft';
/** Distinct from the standing-PR manifest's marker, so neither flow can pick up the other's manifest. */
export const DRAFT_MANIFEST_MARKER = '<!-- releasekit-draft-manifest -->';

export interface StandingPRPublishRequest {
  phase: 'pre-merge' | 'post-merge';
  prNumber: number;
  config: ReleaseKitConfig;
  cwd: string;
  configPath?: string;
}

export interface StandingPRPublishAuthorization {
  manifest: StandingPRManifest;
  pr: PullRequestDetails;
}

export interface StandingPRMergeAuthorization extends StandingPRPublishAuthorization {
  /** The head to pin the merge to, so a push after the manifest was written fails the merge. */
  headSha?: string;
}

export interface DraftPublishRequest {
  phase: 'draft';
  issueNumber: number;
  cwd: string;
  /** The release recomputed at HEAD with this run's flags and config. */
  recomputePlan: () => Promise<VersionOutput | undefined>;
  dryRun?: boolean;
}

export interface DraftPublishAuthorization {
  manifest: StandingPRManifest;
}

export interface DirectReleaseRequest {
  phase: 'direct';
  verdict: GateOutput;
  config: ReleaseKitConfig;
  dryRun?: boolean;
}

/**
 * Refuses the release and posts the refusal report on the PR or issue it names. Naming the wrong kind of PR or issue
 * throws a plain error instead: a report there would read as that PR's own failed release.
 */
class Refusal extends Error {
  constructor(
    message: string,
    readonly retryable = false,
  ) {
    super(message);
  }
}

export function authorizePublish(
  forge: Forge,
  request: StandingPRPublishRequest & { phase: 'pre-merge' },
): Promise<StandingPRMergeAuthorization>;
export function authorizePublish(
  forge: Forge,
  request: StandingPRPublishRequest & { phase: 'post-merge' },
): Promise<StandingPRPublishAuthorization>;
export function authorizePublish(forge: Forge, request: DraftPublishRequest): Promise<DraftPublishAuthorization>;
export function authorizePublish(forge: Forge, request: DirectReleaseRequest): Promise<undefined>;
export async function authorizePublish(
  forge: Forge,
  request: StandingPRPublishRequest | DraftPublishRequest | DirectReleaseRequest,
): Promise<StandingPRPublishAuthorization | DraftPublishAuthorization | undefined> {
  switch (request.phase) {
    case 'pre-merge':
      return authorizeMerge(forge, request);
    case 'post-merge':
      return authorizeMergedPublish(forge, request);
    case 'draft':
      return authorizeDraft(forge, request);
    case 'direct':
      return authorizeDirect(forge, request);
  }
}

interface Refused {
  versionOutput?: VersionOutput;
}

async function reportingRefusals<T>(
  forge: Forge,
  phase: PublishPhase,
  prNumber: number,
  dryRun: boolean | undefined,
  check: (refused: Refused) => Promise<T>,
): Promise<T> {
  const refused: Refused = {};
  try {
    return await check(refused);
  } catch (err) {
    if (err instanceof Refusal && !dryRun) {
      await postRefusalReport(forge, {
        phase,
        prNumber,
        versionOutput: refused.versionOutput,
        reason: err.message,
        retryable: err.retryable,
        retryLabelAvailable: phase === 'post-merge',
      });
    }
    throw err;
  }
}

function assertStandingPR(prNumber: number, pr: PullRequestDetails, ciConfig: CIConfig | undefined, action: string) {
  const branch = ciConfig?.standingPr?.branch ?? 'release/next';
  if (pr.headRef !== branch) {
    throw new Error(
      `Refusing to ${action} PR #${prNumber}: it is not the standing release PR (its head is ` +
        `'${pr.headRef ?? 'unknown'}', not '${branch}').`,
    );
  }
}

/** Every check before the standing PR merges, since the merge puts its version bumps on the base branch. */
async function authorizeMerge(forge: Forge, request: StandingPRPublishRequest): Promise<StandingPRMergeAuthorization> {
  const { prNumber, config } = request;
  const pr = await forge.getPullRequest(prNumber);
  assertStandingPR(prNumber, pr, config.ci, 'merge');
  return reportingRefusals(forge, 'pre-merge', prNumber, false, async (refused) => {
    let manifest: StandingPRManifest;
    try {
      manifest = await readTrustedManifest(forge, prNumber, 'merge');
    } catch (err) {
      if (err instanceof Refusal) {
        throw new Refusal(`${err.message} Re-run 'standing-pr update' to regenerate it.`);
      }
      throw err;
    }
    refused.versionOutput = manifest.versionOutput;
    assertOverrideLabelsCurrent(manifest, prNumber, pr, config.ci, 'merge');
    // Older manifests lack `headSha`, so this only stops a push that lands between the read and the merge.
    return { manifest, pr, headSha: manifest.headSha ?? pr.headSha };
  });
}

/**
 * Every check that can refuse the merged release, before any tag or registry write. Every PR fact comes from the forge,
 * never the triggering event, so a publish from any trigger gets the same answer.
 */
async function authorizeMergedPublish(
  forge: Forge,
  request: StandingPRPublishRequest,
): Promise<StandingPRPublishAuthorization> {
  const { prNumber, config, cwd } = request;
  return reportingRefusals(forge, 'post-merge', prNumber, false, async (refused) => {
    let pr: PullRequestDetails;
    try {
      pr = await forge.getPullRequest(prNumber);
    } catch (err) {
      throw new Refusal(
        `Refusing to publish PR #${prNumber}: it could not be read from GitHub ` +
          `(${err instanceof Error ? err.message : String(err)}), so whether it may be published is unknown. ` +
          'Re-run once the GitHub API is reachable.',
        true,
      );
    }
    if (pr.merged !== true) {
      throw new Error(`Refusing to publish PR #${prNumber}: it has not merged. Merge it first, then publish.`);
    }
    assertStandingPR(prNumber, pr, config.ci, 'publish');

    const manifest = await readTrustedManifest(forge, prNumber, 'publish');
    refused.versionOutput = manifest.versionOutput;
    assertOverrideLabelsCurrent(manifest, prNumber, pr, config.ci, 'publish');
    await assertMergeAuthorized(forge, prNumber, pr, config.ci?.standingPr?.authorization, 'publish');

    const currentSha = await createGitCli().headSha(cwd);
    if (pr.mergeCommitSha && currentSha !== pr.mergeCommitSha) {
      throw new Refusal(
        `Refusing to publish PR #${prNumber}: HEAD is ${currentSha}, not its merge commit ${pr.mergeCommitSha}, so the ` +
          'packages would be built from other commits. Check out the merge commit, then retry.',
        true,
      );
    }
    // A `baseSha` that isn't an ancestor of HEAD means the manifest describes work not on this branch (rewritten
    // history, wrong branch or a forged baseSha).
    if (!(await createGitCli().isAncestor(manifest.baseSha, currentSha, cwd))) {
      throw new Refusal(
        `Refusing to publish PR #${prNumber}: the manifest's baseSha (${manifest.baseSha}) is not an ancestor of ` +
          `HEAD (${currentSha}). The manifest was computed against a commit that is not in this branch's history ` +
          `(the history may have been rewritten).`,
      );
    }

    const { getWorkspacePackageDirs } = await import('@releasekit/version');
    const packageDirs = await getWorkspacePackageDirs({ cwd, configPath: request.configPath });
    await assertManifestMatchesSource(manifest, packageDirs, cwd, prNumber);
    await assertManifestCoversMerge(manifest, pr, packageDirs, cwd, prNumber);
    return { manifest, pr };
  });
}

async function authorizeDraft(forge: Forge, request: DraftPublishRequest): Promise<DraftPublishAuthorization> {
  const { issueNumber } = request;
  const issue = await forge.getIssue(issueNumber);
  if (issue.state === 'closed') {
    throw new Error(
      `Release draft #${issueNumber} is closed. Reopen it to publish it, or run 'releasekit release --draft' ` +
        'for a new draft.',
    );
  }
  if (!issue.labels.includes(DRAFT_LABEL)) {
    throw new Error(
      `Refusing to publish from #${issueNumber}: it is not a release draft (it lacks the '${DRAFT_LABEL}' label). ` +
        "Pass the number of the issue 'releasekit release --draft' reported, or run --draft again.",
    );
  }

  return reportingRefusals(forge, 'draft', issueNumber, request.dryRun, async (refused) => {
    const { comment, refusal } = await findTrustedComment(
      forge,
      issueNumber,
      DRAFT_MANIFEST_MARKER,
      'release-draft manifest',
    );
    if (refusal) {
      throw new Refusal(
        `Refusing to publish from draft #${issueNumber}. ${refusal} Re-run 'releasekit release --draft' with the ` +
          "workflow's GITHUB_TOKEN or a GitHub App installation token, then dispatch the draft issue it reports.",
      );
    }
    if (!comment) {
      throw new Refusal(
        `No release-draft manifest found on issue #${issueNumber}. Pass the number of the issue ` +
          "'releasekit release --draft' reported, or run --draft again.",
      );
    }
    let manifest: StandingPRManifest;
    try {
      manifest = parseManifest(comment.body);
    } catch (err) {
      throw new Refusal(
        `Release manifest on draft #${issueNumber} is invalid or incompatible. Re-run 'releasekit release --draft'. ` +
          `Details: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    refused.versionOutput = manifest.versionOutput;

    // A different HEAD could publish something other than what was reviewed.
    const currentSha = await createGitCli().headSha(request.cwd);
    if (currentSha !== manifest.baseSha) {
      throw new Refusal(
        `Release draft #${issueNumber} was computed at ${manifest.baseSha} but HEAD is ${currentSha}. ` +
          "Re-run 'releasekit release --draft' to refresh the draft, then dispatch again.",
      );
    }

    // baseSha pins the commit but not the CLI flags or config.
    if (!samePlan(await request.recomputePlan(), manifest.versionOutput)) {
      throw new Refusal(
        `The release plan recomputed at dispatch differs from the reviewed draft #${issueNumber}. ` +
          "Re-run 'releasekit release --draft' to refresh the draft, then dispatch with the same flags.",
      );
    }
    return { manifest };
  });
}

/** A direct push has no merger: the gate's release-strategy check is its guard. */
async function authorizeDirect(forge: Forge, request: DirectReleaseRequest): Promise<undefined> {
  const { verdict } = request;
  const standingRefusal = verdict.evaluations.find((e) => e.refusedStandingPr);
  if (standingRefusal) {
    // Fail rather than skip, so the job's next step doesn't reconcile the standing PR while it publishes.
    throw new Error(standingRefusal.reason);
  }
  const authz = request.config.ci?.standingPr?.authorization;
  const winner = verdict.shouldRelease ? verdict.evaluations.find((e) => e.shouldRelease) : undefined;
  if (!winner || !authz?.enforceMergeAuthor) {
    return undefined;
  }
  const prNumber = winner.prNumber;
  await reportingRefusals(forge, 'direct', prNumber, request.dryRun, async () => {
    let pr: PullRequestDetails;
    try {
      pr = await forge.getPullRequest(prNumber);
    } catch (err) {
      throw new Refusal(
        `Refusing to release from PR #${prNumber}: enforceMergeAuthor is set but the merger is unknown - the PR ` +
          `could not be read from GitHub (${err instanceof Error ? err.message : String(err)}).`,
        true,
      );
    }
    await assertMergeAuthorized(forge, prNumber, pr, authz, 'release from');
  });
  return undefined;
}

async function readTrustedManifest(
  forge: Forge,
  prNumber: number,
  action: 'merge' | 'publish',
): Promise<StandingPRManifest> {
  const { comment, refusal } = await findTrustedComment(forge, prNumber, MANIFEST_MARKER, 'release manifest');
  if (refusal) {
    throw new Refusal(`Refusing to ${action} PR #${prNumber}. ${refusal}`);
  }
  if (!comment) {
    throw new Refusal(`Release manifest not found on PR #${prNumber}.`);
  }

  try {
    return parseManifest(comment.body);
  } catch (err) {
    throw new Refusal(
      `Release manifest on PR #${prNumber} is invalid or incompatible. Details: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/** The standing PR's manifest, or null when it is missing or can't be trusted or parsed. */
export async function findTrustedManifest(forge: Forge, prNumber: number): Promise<StandingPRManifest | null> {
  try {
    return await readTrustedManifest(forge, prNumber, 'publish');
  } catch (err) {
    if (err instanceof Refusal) {
      return null;
    }
    throw err;
  }
}

function assertOverrideLabelsCurrent(
  manifest: StandingPRManifest,
  prNumber: number,
  pr: PullRequestDetails,
  ciConfig: CIConfig | undefined,
  action: 'merge' | 'publish',
): void {
  if (manifest.overrideLabels === undefined) {
    return;
  }
  const prLabels = extractOverrideLabels((pr.labels ?? []).filter(Boolean), ciConfig);
  const manifestLabels = [...manifest.overrideLabels].sort();
  if (prLabels.join('\n') !== manifestLabels.join('\n')) {
    throw new Refusal(
      `Standing PR #${prNumber} override labels changed after the last update — the release manifest is stale.\n` +
        `  manifest was computed for: [${manifestLabels.join(', ') || '(none)'}]\n` +
        `  PR now has:                [${prLabels.join(', ') || '(none)'}]\n` +
        `${action === 'merge' ? "Re-run 'releasekit standing-pr update' so the manifest matches, then merge again. " : ''}` +
        `Refusing to ${action} a release the labels no longer describe.`,
    );
  }
}

/** Defense in depth behind the branch-protection ruleset, catching a missing or misconfigured one. */
async function assertMergeAuthorized(
  forge: Forge,
  prNumber: number,
  pr: PullRequestDetails,
  authz: StandingPrAuthorization | undefined,
  action: 'publish' | 'release from',
): Promise<void> {
  if (!authz?.enforceMergeAuthor) {
    return;
  }
  const merger = pr.mergedBy;
  if (!merger) {
    throw new Refusal(
      `Refusing to ${action} PR #${prNumber}: enforceMergeAuthor is set but GitHub reports no merger for it. To ` +
        `${action === 'publish' ? 'publish' : 'release'} without the merge-author check, set ` +
        'ci.standingPr.authorization.enforceMergeAuthor: false.',
    );
  }
  let authorized = true;
  try {
    authorized = await isAuthorizedActor(forge, merger.login, merger.type, authz);
  } catch (err) {
    warn(
      `Could not verify merger '${merger.login}' permission — proceeding, since branch protection is the primary gate: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!authorized) {
    const protectedBranch = action === 'publish' ? 'the release branch' : 'the base branch';
    throw new Refusal(
      `Refusing to ${action} PR #${prNumber}: it was merged by '${merger.login}', who lacks the required '${authz.requiredPermission}' permission (ci.standingPr.authorization). Restrict who can merge ${protectedBranch} with a branch-protection ruleset, or set ci.standingPr.authorization.enforceMergeAuthor: false.`,
    );
  }
}

/**
 * The manifest's versions and tags are never trusted verbatim: the merged commit's package manifests are the ground
 * truth, and any divergence rejects the whole manifest before any tag or registry write.
 */
async function assertManifestMatchesSource(
  manifest: StandingPRManifest,
  packageDirs: Record<string, string>,
  cwd: string,
  prNumber: number,
): Promise<void> {
  const { readManifestVersion } = await import('@releasekit/version');
  const publishable = publishableUpdates(manifest.versionOutput);

  const validatedVersions: string[] = [];
  for (const update of publishable) {
    const dir = packageDirs[update.packageName];
    if (dir === undefined) {
      throw new Refusal(
        `Refusing to publish PR #${prNumber}: the release manifest lists package '${update.packageName}', which is ` +
          `not in the workspace at the merged commit. The manifest does not match the source — it may have been ` +
          `edited.`,
      );
    }
    // filePath too: the registries publish from its directory, and an edited `files` could leave it out.
    for (const file of new Set([update.filePath, ...(update.files ?? [])])) {
      const manifestPath = path.resolve(cwd, file);
      // Another package's manifest would vouch for a version this package doesn't have.
      if (path.dirname(manifestPath) !== path.resolve(dir)) {
        throw new Refusal(
          `Refusing to publish PR #${prNumber}: the release manifest lists '${path.relative(cwd, manifestPath)}' for '${update.packageName}', ` +
            `which is not in that package's directory at the merged commit. The manifest does not match the source — ` +
            `it may have been edited.`,
        );
      }
      let actual: string | undefined;
      try {
        actual = readManifestVersion(manifestPath);
      } catch (err) {
        throw new Refusal(
          `Refusing to publish PR #${prNumber}: the release manifest lists '${path.relative(cwd, manifestPath)}' for ` +
            `'${update.packageName}', which can't be read as a package manifest at the merged commit ` +
            `(${err instanceof Error ? err.message : String(err)}). The manifest does not match the source — it may ` +
            `have been edited.`,
        );
      }
      if (actual !== update.newVersion) {
        throw new Refusal(
          `Refusing to publish PR #${prNumber}: the release manifest claims '${update.packageName}@${update.newVersion}', ` +
            `but the merged source has '${update.packageName}@${actual}' in ${path.relative(cwd, manifestPath)}. The ` +
            `manifest does not match what was merged — it may have been edited.`,
        );
      }
    }
    validatedVersions.push(update.newVersion);
  }

  // Baseline tags are pushed alongside consumer tags, so both must carry a validated version. Runs even when
  // `validatedVersions` is empty: a legitimate manifest then has no tags, so every tag is rejected.
  for (const tag of [...manifest.versionOutput.tags, ...(manifest.versionOutput.baselineTags ?? [])]) {
    // Bounded by anything but a digit, dot or prerelease/build separator (`-`/`+`), or a rogue tag like `v1.2.30`,
    // `v11.2.3` or `v1.2.3-evil` passes for a validated `1.2.3`.
    const carriesValidatedVersion = validatedVersions.some((version) => {
      const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`(?<![\\d.])${escaped}(?![\\d.+-])`).test(tag);
    });
    if (!carriesValidatedVersion) {
      throw new Refusal(
        `Refusing to publish PR #${prNumber}: the release manifest lists tag '${tag}', which does not correspond to ` +
          `any package/version being published. The manifest does not match the source — it may have been edited.`,
      );
    }
    // A forged `@scope/evil@v1.2.3` at a real published version passes the version check, so a scoped tag must also
    // name a published package. Bare and unscoped tags have no reliably delimitable name.
    const scopedPackage = /@[^\s@/]+\/[^\s@]+?(?=@)/.exec(tag)?.[0];
    if (scopedPackage && !publishable.some((u) => u.packageName === scopedPackage)) {
      throw new Refusal(
        `Refusing to publish PR #${prNumber}: the release manifest lists tag '${tag}', whose package ` +
          `'${scopedPackage}' is not among the packages being published. The manifest does not match the source — ` +
          `it may have been edited.`,
      );
    }
  }
}

const VERSION_MANIFESTS = ['package.json', 'Cargo.toml', 'pubspec.yaml'];

/**
 * Workspace packages whose version `mergeSha` changes against its first parent. Like discovery, a package's version
 * is its first manifest that has one, so a sibling such as a virtual-workspace Cargo.toml is never parsed.
 */
async function packagesBumpedBy(mergeSha: string, packageDirs: Record<string, string>, cwd: string): Promise<string[]> {
  const { readManifestVersion } = await import('@releasekit/version');
  const git = createGitCli();
  const bumped: string[] = [];
  for (const [name, dir] of Object.entries(packageDirs)) {
    for (const file of VERSION_MANIFESTS) {
      // Git reads `<rev>:<path>` with forward slashes only.
      const relative = path.relative(cwd, path.join(dir, file)).split(path.sep).join('/');
      const after = await git.readFileAt(mergeSha, relative, cwd);
      const version = after === null ? undefined : readManifestVersion(relative, after);
      if (version === undefined) {
        continue;
      }
      const before = await git.readFileAt(`${mergeSha}^1`, relative, cwd);
      if (before === null || readManifestVersion(relative, before) !== version) {
        bumped.push(name);
      }
      break;
    }
  }
  return bumped;
}

/**
 * The branch can move after the last update, so the PR may merge a head the manifest doesn't describe. The manifest's
 * versions are already checked against the merged tree, but it can still miss a package the merge bumps, leaving that
 * package untagged and unpublished on the base branch.
 */
async function assertManifestCoversMerge(
  manifest: StandingPRManifest,
  pr: PullRequestDetails,
  packageDirs: Record<string, string>,
  cwd: string,
  prNumber: number,
): Promise<void> {
  const { headSha, mergeCommitSha } = pr;
  if (!manifest.headSha || !headSha || headSha === manifest.headSha) {
    return;
  }
  const heads = `PR #${prNumber} merged head ${headSha}, but its release manifest describes ${manifest.headSha}`;
  if (!mergeCommitSha) {
    throw new Refusal(
      `Refusing to publish: ${heads}, and the merge commit is unknown, so the packages it bumps can't be checked ` +
        `against the manifest.`,
      true,
    );
  }
  // Every update, not just the publishable ones: a sync root bump is listed and lands as planned.
  const listed = new Set(manifest.versionOutput.updates.map((u) => u.packageName));
  const missing = (await packagesBumpedBy(mergeCommitSha, packageDirs, cwd)).filter((name) => !listed.has(name));
  if (missing.length > 0) {
    throw new Refusal(
      `Refusing to publish: ${heads}. The merge bumps ${missing.map((name) => `'${name}'`).join(', ')}, which the ` +
        `manifest doesn't list, so publishing would leave them versioned but never tagged or published. Requiring ` +
        `the 'releasekit/standing-pr' status check stops a merge landing before its manifest is written.`,
    );
  }
  warn(`${heads}. Publishing anyway: the manifest lists every package the merge bumps.`);
}

/** Order-independent arrays are sorted so a reordering alone never reads as drift. */
function planFingerprint(v: VersionOutput, withFiles: boolean, withChangelogTags: boolean): string {
  const byName = <T extends { packageName: string }>(arr: readonly T[]) =>
    [...arr].sort((a, b) => a.packageName.localeCompare(b.packageName));
  const updates = withFiles ? v.updates : v.updates.map(({ files: _files, ...update }) => update);
  const changelogs = withChangelogTags ? v.changelogs : v.changelogs.map(({ tag: _tag, ...changelog }) => changelog);
  return JSON.stringify({
    strategy: v.strategy ?? null,
    commitMessage: v.commitMessage ?? null,
    tags: [...v.tags].sort(),
    baselineTags: [...(v.baselineTags ?? [])].sort(),
    updates: byName(updates),
    changelogs: byName(changelogs),
    sharedEntries: v.sharedEntries ?? [],
  });
}

/**
 * The full plan, not just name@version: a recompute at the pinned baseSha can keep every version yet differ in tags,
 * commit message, the root update or changelogs (drifted flags or config).
 */
function samePlan(recomputed: VersionOutput | undefined, draft: VersionOutput): boolean {
  if (!recomputed) {
    return false;
  }
  // A draft written before updates listed their `files`, or changelogs their `tag`, would otherwise never match.
  const withFiles = draft.updates.some((u) => u.files !== undefined);
  const withChangelogTags = draft.changelogs.some((c) => c.tag !== undefined);
  return (
    planFingerprint(recomputed, withFiles, withChangelogTags) === planFingerprint(draft, withFiles, withChangelogTags)
  );
}
