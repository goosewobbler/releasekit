import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import { type CIConfig, loadConfig as loadReleaseKitConfig } from '@releasekit/config';
import type { VersionOutput } from '@releasekit/core';
import { error, info, success, warn } from '@releasekit/core';
import { formatDuration, parseDuration } from '../duration.js';
import { getGitHubContext, getHeadCommitMessage, matchesSkipPattern } from '../git.js';
import { createOctokit, findStandingPR as findStandingPRFromConfig } from '../github.js';
import { runNotesStep, runPublishStep, runVersionStep } from '../steps.js';
import type { ReleaseOptions, ReleaseOutput } from '../types.js';
import { postStandingPRStatusSafe } from './status.js';

const MANIFEST_MARKER = '<!-- releasekit-manifest -->';
const MANIFEST_SCHEMA_VERSION = 2;
const MANIFEST_SCHEMA_MIN_VERSION = 1;
const EDITABLE_START = '<!-- releasekit-editable-start -->';
const EDITABLE_END = '<!-- releasekit-editable-end -->';

export interface StandingPROptions {
  config?: string;
  projectDir: string;
  verbose: boolean;
  quiet: boolean;
  json: boolean;
  npmAuth?: string;
}

export interface StandingPRResult {
  action: 'created' | 'updated' | 'closed' | 'noop';
  prNumber?: number;
  prUrl?: string;
  versionOutput?: VersionOutput;
}

export interface StandingPRManifest {
  schemaVersion: 1 | 2;
  versionOutput: VersionOutput;
  releaseNotes: Record<string, string>;
  notesFiles: string[];
  createdAt: string;
  baseSha: string;
  notesHash?: string;
  /** ISO timestamp of when this standing PR was first created. Preserved across updates. Added in schema v2. */
  firstUpdatedAt?: string;
}

function getHeadSha(cwd: string): string {
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf-8', cwd }).trim();
  } catch (err) {
    throw new Error(`Failed to get HEAD SHA: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function resetReleaseBranch(branch: string, base: string, cwd: string): void {
  execSync('git fetch origin', { encoding: 'utf-8', cwd, stdio: 'pipe' });

  // Check if branch exists on remote
  let remoteExists = false;
  try {
    execSync(`git ls-remote --exit-code --heads origin "${branch}"`, { encoding: 'utf-8', cwd, stdio: 'pipe' });
    remoteExists = true;
  } catch {
    remoteExists = false;
  }

  if (remoteExists) {
    // Reset existing branch to base
    try {
      execSync(`git checkout "${branch}"`, { encoding: 'utf-8', cwd, stdio: 'pipe' });
    } catch {
      execSync(`git checkout -b "${branch}"`, { encoding: 'utf-8', cwd, stdio: 'pipe' });
    }
    execSync(`git reset --hard "origin/${base}"`, { encoding: 'utf-8', cwd, stdio: 'pipe' });
  } else {
    // Create branch from base
    try {
      execSync(`git checkout -b "${branch}" "origin/${base}"`, { encoding: 'utf-8', cwd, stdio: 'pipe' });
    } catch {
      execSync(`git checkout "${branch}"`, { encoding: 'utf-8', cwd, stdio: 'pipe' });
      execSync(`git reset --hard "origin/${base}"`, { encoding: 'utf-8', cwd, stdio: 'pipe' });
    }
  }
}

function commitAndForcePush(branch: string, cwd: string): void {
  execSync('git add -A', { encoding: 'utf-8', cwd, stdio: 'pipe' });

  // Check if there's anything to commit
  const status = execSync('git status --porcelain', { encoding: 'utf-8', cwd }).trim();
  if (status) {
    execSync('git commit -m "chore: release preparation [skip ci]"', { encoding: 'utf-8', cwd, stdio: 'pipe' });
  }

  execSync(`git push --force-with-lease origin "${branch}"`, { encoding: 'utf-8', cwd, stdio: 'pipe' });
}

// Renders the release notes section content (without editable markers).
// Used both for writing to PR bodies and for computing notesHash.
function renderNotesSection(versionOutput: VersionOutput, releaseNotes: Record<string, string>): string {
  const lines: string[] = ['### Release Notes', ''];
  for (const [pkg, notes] of Object.entries(releaseNotes)) {
    const update = versionOutput.updates.find((u) => u.packageName === pkg);
    if (update) {
      lines.push(`#### ${pkg} — ${update.newVersion}`, '');
    } else {
      lines.push(`#### ${pkg}`, '');
    }
    lines.push(notes.trim(), '');
  }
  if (lines[lines.length - 1] === '') lines.pop();
  return lines.join('\n');
}

function computeNotesHash(section: string): string {
  return createHash('sha256').update(section).digest('hex').slice(0, 16);
}

// Extracts the content between editable markers from a PR body, or null if markers are absent.
export function extractEditableSection(body: string): string | null {
  const start = body.indexOf(EDITABLE_START);
  const end = body.indexOf(EDITABLE_END);
  if (start === -1 || end === -1 || end < start) return null;
  return body.slice(start + EDITABLE_START.length, end).trim();
}

// Parses an editable section back into per-package notes using a line-by-line accumulator.
// Package headings are "#### <pkg> — <version>" (em dash U+2014). h4 subheadings within
// notes (e.g. "#### Breaking Changes") have no em dash and are accumulated as content.
// [^—]+ is used for the package-name portion to avoid backtracking ambiguity.
export function parseEditedNotes(section: string): Record<string, string> {
  const result: Record<string, string> = {};
  let currentPkg: string | null = null;
  const accum: string[] = [];

  const flush = () => {
    if (currentPkg !== null) {
      result[currentPkg] = accum.join('\n').trim();
      accum.length = 0;
    }
  };

  for (const line of section.split('\n')) {
    const headingMatch = line.match(/^#### ([^—]+) — \S/);
    if (headingMatch?.[1]) {
      flush();
      currentPkg = headingMatch[1].trim();
    } else if (currentPkg !== null) {
      accum.push(line);
    }
  }
  flush();

  return result;
}

function deleteReleaseBranch(releaseBranch: string, cwd: string): void {
  try {
    execSync(`git push origin --delete "${releaseBranch}"`, { encoding: 'utf-8', cwd, stdio: 'pipe' });
    info(`Deleted release branch '${releaseBranch}'`);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    if (errorMsg.includes('not found') || errorMsg.includes('does not exist')) {
      info(`Release branch '${releaseBranch}' already deleted`);
    } else {
      warn(`Failed to delete release branch '${releaseBranch}': ${errorMsg}`);
    }
  }
}

function renderPrBody(
  versionOutput: VersionOutput,
  releaseNotes: Record<string, string>,
  editableNotes = false,
  overrideSection?: string,
): string {
  const lines: string[] = [
    '## Release',
    '',
    'This PR was automatically generated by [ReleaseKit](https://github.com/goosewobbler/releasekit).',
    'Merging this PR will publish the following packages:',
    '',
    '| Package | Version |',
    '|---------|---------|',
  ];

  for (const update of versionOutput.updates) {
    lines.push(`| \`${update.packageName}\` | ${update.newVersion} |`);
  }

  const hasNotes = Object.keys(releaseNotes).length > 0;
  if (hasNotes) {
    const sectionContent = overrideSection ?? renderNotesSection(versionOutput, releaseNotes);
    lines.push('');
    if (editableNotes) {
      lines.push(EDITABLE_START, sectionContent, EDITABLE_END, '');
    } else {
      lines.push(sectionContent, '');
    }
  }

  lines.push('---', '> Merge this PR to publish. The release will be triggered automatically.');
  return lines.join('\n');
}

export function serializeManifest(m: StandingPRManifest): string {
  const json = JSON.stringify(m);
  const encoded = Buffer.from(json).toString('base64');
  return [
    MANIFEST_MARKER,
    '<details><summary>Release manifest (do not edit)</summary>',
    '',
    `<!-- base64 ${encoded} -->`,
    '',
    '</details>',
  ].join('\n');
}

export function parseManifest(commentBody: string): StandingPRManifest {
  const b64Match = commentBody.match(/<!-- base64 ([A-Za-z0-9+/=]+) -->/);
  if (!b64Match?.[1]) {
    throw new Error('Release manifest not found or malformed in PR comment');
  }

  let json: string;
  try {
    json = Buffer.from(b64Match[1], 'base64').toString('utf-8');
  } catch {
    throw new Error('Release manifest encoding is invalid');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('Release manifest JSON is malformed');
  }

  const m = parsed as StandingPRManifest;
  if (m.schemaVersion < MANIFEST_SCHEMA_MIN_VERSION || m.schemaVersion > MANIFEST_SCHEMA_VERSION) {
    throw new Error(
      `Release manifest schema version ${m.schemaVersion} is incompatible (expected ${MANIFEST_SCHEMA_MIN_VERSION}–${MANIFEST_SCHEMA_VERSION}). Re-run 'standing-pr update' to regenerate.`,
    );
  }

  return m;
}

type OctokitInstance = ReturnType<typeof createOctokit>;

export async function findManifestComment(
  octokit: OctokitInstance,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<{ id: number; body: string } | null> {
  const iterator = octokit.paginate.iterator(octokit.rest.issues.listComments, {
    owner,
    repo,
    issue_number: prNumber,
    per_page: 100,
  });

  for await (const response of iterator) {
    for (const comment of response.data) {
      if (comment.body?.startsWith(MANIFEST_MARKER)) {
        return { id: comment.id, body: comment.body };
      }
    }
  }

  return null;
}

export async function findStandingPR(
  octokit: OctokitInstance,
  owner: string,
  repo: string,
  branch: string,
): Promise<{ number: number; url: string; labels: string[] } | null> {
  const { data: prs } = await octokit.rest.pulls.list({
    owner,
    repo,
    head: `${owner}:${branch}`,
    state: 'open',
    per_page: 1,
  });

  const pr = prs[0];
  if (!pr) return null;
  const labels = (pr.labels ?? []).map((l) => (typeof l === 'string' ? l : (l.name ?? ''))).filter(Boolean);
  return { number: pr.number, url: pr.html_url, labels };
}

/**
 * Read-only snapshot of the current standing PR, used by the preview command to render
 * a "true release preview" comment (queued packages + minAge gate state).
 *
 * Returns null when no standing PR exists or its manifest comment is missing/malformed.
 */
export interface StandingPRSnapshot {
  number: number;
  url: string;
  manifest: StandingPRManifest;
  /** ISO timestamp of when the standing PR was first opened. */
  openedAt: string;
  /** 'success' = ready to merge; 'pending' = waiting on minAge. */
  gateState: 'success' | 'pending';
  /** Humanized "Waiting Xh Ym for minAge" when gateState === 'pending'. */
  gateReason?: string;
}

export async function fetchStandingPRSnapshot(
  octokit: OctokitInstance,
  owner: string,
  repo: string,
  ciConfig: CIConfig | undefined,
): Promise<StandingPRSnapshot | null> {
  const pr = await findStandingPRFromConfig(octokit, owner, repo, ciConfig);
  if (!pr) return null;

  const comment = await findManifestComment(octokit, owner, repo, pr.number);
  if (!comment) return null;

  let manifest: StandingPRManifest;
  try {
    manifest = parseManifest(comment.body);
  } catch {
    return null;
  }

  const openedAt = manifest.firstUpdatedAt ?? manifest.createdAt;
  const minAge = ciConfig?.standingPr?.minAge;
  let gateState: 'success' | 'pending' = 'success';
  let gateReason: string | undefined;

  if (minAge !== undefined && manifest.firstUpdatedAt) {
    const minAgeMs = parseDuration(minAge);
    if (minAgeMs !== null) {
      const ageMs = Date.now() - new Date(manifest.firstUpdatedAt).getTime();
      if (ageMs < minAgeMs) {
        gateState = 'pending';
        gateReason = `Waiting ${formatDuration(minAgeMs - ageMs)} for minAge`;
      }
    }
  }

  return { number: pr.number, url: pr.url, manifest, openedAt, gateState, gateReason };
}

/**
 * Overrides resolved from labels on the standing PR itself. The standing PR is the canonical
 * surface for adjusting bump magnitude, scope, and channel — feeder PR labels are advisory.
 */
interface StandingPrOverrides {
  bump?: 'major' | 'minor' | 'patch';
  target?: string;
  stable?: boolean;
  prerelease?: boolean;
  /** Human-readable conflict descriptions (used for the pending status check). Empty when no conflict. */
  conflicts: string[];
}

function resolveStandingPrLabelOverrides(prLabels: string[], ciConfig: CIConfig | undefined): StandingPrOverrides {
  // Return a fresh object rather than a shared constant — callers may mutate `conflicts`.
  if (!prLabels || prLabels.length === 0) return { conflicts: [] };
  const labels = ciConfig?.labels ?? {
    stable: 'channel:stable',
    prerelease: 'channel:prerelease',
    skip: 'release:skip',
    immediate: 'release:immediate',
    major: 'bump:major',
    minor: 'bump:minor',
    patch: 'bump:patch',
  };
  const scopeLabels = ciConfig?.scopeLabels ?? {};
  const conflicts: string[] = [];

  // Bump
  let bump: 'major' | 'minor' | 'patch' | undefined;
  const bumpsPresent = [
    prLabels.includes(labels.major) ? labels.major : undefined,
    prLabels.includes(labels.minor) ? labels.minor : undefined,
    prLabels.includes(labels.patch) ? labels.patch : undefined,
  ].filter(Boolean) as string[];
  if (bumpsPresent.length > 1) {
    conflicts.push(`Conflicting bump labels on standing PR (${bumpsPresent.join(', ')}) — remove all but one`);
  } else if (prLabels.includes(labels.major)) bump = 'major';
  else if (prLabels.includes(labels.minor)) bump = 'minor';
  else if (prLabels.includes(labels.patch)) bump = 'patch';

  // Channel modifiers
  const hasStable = prLabels.includes(labels.stable);
  const hasPrerelease = prLabels.includes(labels.prerelease);
  let stable: boolean | undefined;
  let prerelease: boolean | undefined;
  if (hasStable && hasPrerelease) {
    conflicts.push(`Conflicting channel labels on standing PR (${labels.stable} and ${labels.prerelease})`);
  } else {
    if (hasStable) stable = true;
    if (hasPrerelease) prerelease = true;
  }

  // Scope: first matching configured scope label wins
  let target: string | undefined;
  for (const [labelName, pattern] of Object.entries(scopeLabels)) {
    if (prLabels.includes(labelName)) {
      target = pattern;
      break;
    }
  }

  return { bump, target, stable, prerelease, conflicts };
}

interface BuildOptionsExtras {
  /** Per-package vs synced versioning. Inherited from version.sync config (default true). */
  sync?: boolean;
  bump?: 'major' | 'minor' | 'patch';
  target?: string;
  stable?: boolean;
  prerelease?: boolean;
}

function buildBaseReleaseOptions(
  options: StandingPROptions,
  dryRun: boolean,
  extras?: BuildOptionsExtras,
): ReleaseOptions {
  return {
    config: options.config,
    dryRun,
    sync: extras?.sync ?? true,
    bump: extras?.bump,
    target: extras?.target,
    stable: extras?.stable,
    prerelease: extras?.prerelease ? true : undefined,
    skipNotes: true,
    skipPublish: true,
    skipGit: true,
    skipGithubRelease: true,
    skipVerification: true,
    json: options.json,
    verbose: options.verbose,
    quiet: options.quiet,
    projectDir: options.projectDir,
    npmAuth: (options.npmAuth as ReleaseOptions['npmAuth']) ?? 'auto',
  };
}

export async function runStandingPRUpdate(options: StandingPROptions): Promise<StandingPRResult> {
  const cwd = options.projectDir;

  const releaseKitConfig = loadReleaseKitConfig({ cwd, configPath: options.config });
  const ciConfig = releaseKitConfig.ci;
  const standingPrConfig = ciConfig?.standingPr;

  const branch = standingPrConfig?.branch ?? 'release/next';
  const base = releaseKitConfig.git?.branch ?? 'main';
  const skipPatterns = releaseKitConfig.release?.ci?.skipPatterns ?? ['chore: release '];

  // Skip-pattern guard
  const headSubject = getHeadCommitMessage(cwd);
  if (headSubject && matchesSkipPattern(headSubject, skipPatterns)) {
    info(`Skipping standing PR update: commit matches skip pattern`);
    return { action: 'noop' };
  }

  const githubContext = getGitHubContext();

  // Look up the existing standing PR up front (one API call, reused throughout). Its labels
  // are the canonical override surface — `bump:*` / `scope:*` / channel labels applied to
  // the standing PR drive the next update.
  let existingStandingPr: { number: number; url: string; labels: string[] } | null = null;
  if (githubContext?.token) {
    try {
      const lookupOctokit = createOctokit(githubContext.token);
      existingStandingPr = await findStandingPR(lookupOctokit, githubContext.owner, githubContext.repo, branch);
    } catch (err) {
      warn(`Could not look up standing PR for label overrides: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const overrides = resolveStandingPrLabelOverrides(existingStandingPr?.labels ?? [], ciConfig);
  if (overrides.bump) info(`Standing PR label override: bump=${overrides.bump}`);
  if (overrides.target) info(`Standing PR label override: target=${overrides.target}`);
  if (overrides.stable) info(`Standing PR label override: channel:stable`);
  if (overrides.prerelease) info(`Standing PR label override: channel:prerelease`);
  for (const conflict of overrides.conflicts) warn(conflict);

  // Inherit sync from the loaded version config (defaults to true) — never silently force false.
  const sync = releaseKitConfig.version?.sync ?? true;
  // When labels conflict, drop the override (fall back to commit-driven) but keep the
  // conflict descriptions for the final status check.
  const buildExtras: BuildOptionsExtras = overrides.conflicts.length
    ? { sync, target: overrides.target }
    : {
        sync,
        bump: overrides.bump,
        target: overrides.target,
        stable: overrides.stable,
        prerelease: overrides.prerelease,
      };

  // Dry-run version analysis to compute bumps without writing
  info('Running version analysis (dry run)...');
  const dryRunOptions = buildBaseReleaseOptions(options, true, buildExtras);
  const versionOutputDry = await runVersionStep(dryRunOptions);

  if (versionOutputDry.updates.length === 0) {
    info('No releasable changes found');

    if (githubContext?.token && existingStandingPr) {
      const octokit = createOctokit(githubContext.token);
      await octokit.rest.issues.createComment({
        owner: githubContext.owner,
        repo: githubContext.repo,
        issue_number: existingStandingPr.number,
        body: 'No releasable changes found. Closing this PR as the release queue is empty.',
      });
      await octokit.rest.pulls.update({
        owner: githubContext.owner,
        repo: githubContext.repo,
        pull_number: existingStandingPr.number,
        state: 'closed',
      });
      info(`Closed standing PR #${existingStandingPr.number}`);
      return { action: 'closed', prNumber: existingStandingPr.number, prUrl: existingStandingPr.url };
    }

    return { action: 'noop' };
  }

  // minPackages gate: close existing PR and noop if package count is below threshold
  const minPackages = standingPrConfig?.minPackages;
  if (minPackages !== undefined && versionOutputDry.updates.length < minPackages) {
    info(
      `Package count (${versionOutputDry.updates.length}) is below minPackages threshold (${minPackages}), skipping`,
    );
    if (githubContext?.token && existingStandingPr) {
      const octokit = createOctokit(githubContext.token);
      await octokit.rest.issues.createComment({
        owner: githubContext.owner,
        repo: githubContext.repo,
        issue_number: existingStandingPr.number,
        body: `Not enough packages with releasable changes (${versionOutputDry.updates.length} of ${minPackages} required). Closing until the threshold is reached.`,
      });
      await octokit.rest.pulls.update({
        owner: githubContext.owner,
        repo: githubContext.repo,
        pull_number: existingStandingPr.number,
        state: 'closed',
      });
      info(`Closed standing PR #${existingStandingPr.number} (minPackages not met)`);
      return { action: 'closed', prNumber: existingStandingPr.number, prUrl: existingStandingPr.url };
    }
    return { action: 'noop' };
  }

  // Capture baseSha before switching branches
  const baseSha = getHeadSha(cwd);

  // Branch management: reset release branch to base
  info(`Resetting release branch '${branch}' to origin/${base}...`);
  resetReleaseBranch(branch, base, cwd);

  // Materialize changes on release branch
  info('Writing version bumps...');
  const writeOptions = buildBaseReleaseOptions(options, false, buildExtras);
  const versionOutput = await runVersionStep(writeOptions);

  info('Generating release notes...');
  const notesOptions = { ...writeOptions, skipNotes: false };
  const notesResult = await runNotesStep(versionOutput, notesOptions);

  // Commit and force-push the release branch
  info(`Committing and pushing '${branch}'...`);
  commitAndForcePush(branch, cwd);

  // Capture the release branch HEAD SHA for the status check (we're still on the release branch)
  const releaseBranchSha = getHeadSha(cwd);

  success(`Release branch '${branch}' updated`);

  if (!githubContext?.token) {
    warn('No GitHub context available — skipping PR creation');
    return { action: 'noop', versionOutput };
  }

  const octokit = createOctokit(githubContext.token);
  const { owner, repo } = githubContext;

  // Build PR title and labels
  const count = versionOutput.updates.length;
  const firstUpdate = versionOutput.updates[0];
  /* biome-ignore lint/suspicious/noTemplateCurlyInString: template string uses config variable */
  const titleTemplate = standingPrConfig?.title ?? 'chore: release ${count} package(s)';
  const title = titleTemplate
    .replace(/\$\{count\}/g, String(count))
    .replace(/\$\{version\}/g, firstUpdate?.newVersion ?? '');

  const labels = standingPrConfig?.labels ?? ['release'];
  const editableNotesEnabled = standingPrConfig?.editableNotes ?? false;
  const hasNotes = Object.keys(notesResult.releaseNotes ?? {}).length > 0;

  // Pre-compute fresh notes section and its hash for edit-detection tracking
  const freshSection =
    editableNotesEnabled && hasNotes ? renderNotesSection(versionOutput, notesResult.releaseNotes ?? {}) : undefined;
  const notesHash = freshSection ? computeNotesHash(freshSection) : undefined;

  // Reuse the standing PR fetched at the top of this function — same source of truth as the
  // label override resolution; saves an extra API call.
  const existing = existingStandingPr;

  // When editableNotes is enabled and a PR exists, check whether the user has manually
  // edited the notes section. If the current section hash differs from the stored hash,
  // preserve the user's edits rather than overwriting them.
  let overrideSection: string | undefined;
  if (editableNotesEnabled && existing && freshSection) {
    const existingManifestComment = await findManifestComment(octokit, owner, repo, existing.number);
    if (existingManifestComment) {
      try {
        const existingManifest = parseManifest(existingManifestComment.body);
        if (existingManifest.notesHash) {
          const { data: prData } = await octokit.rest.pulls.get({
            owner,
            repo,
            pull_number: existing.number,
          });
          if (prData.body) {
            const currentSection = extractEditableSection(prData.body);
            if (currentSection && computeNotesHash(currentSection) !== existingManifest.notesHash) {
              warn('User has edited the release notes section — preserving edits');
              overrideSection = currentSection;
            }
          }
        }
      } catch {
        // Can't parse manifest — proceed with fresh generation
      }
    }
  }

  const body = renderPrBody(versionOutput, notesResult.releaseNotes ?? {}, editableNotesEnabled, overrideSection);

  let prNumber: number;
  let prUrl: string;
  let action: StandingPRResult['action'];

  if (existing) {
    await octokit.rest.pulls.update({
      owner,
      repo,
      pull_number: existing.number,
      title,
      body,
    });
    prNumber = existing.number;
    prUrl = existing.url;
    action = 'updated';
    info(`Updated standing PR #${prNumber}`);
  } else {
    const { data: newPr } = await octokit.rest.pulls.create({
      owner,
      repo,
      title,
      body,
      head: branch,
      base,
    });
    prNumber = newPr.number;
    prUrl = newPr.html_url;
    action = 'created';
    info(`Created standing PR #${prNumber}`);
  }

  // Apply labels — preserve any maintainer-added labels (e.g. bump:major, scope:foo) by
  // taking the union of currently-applied labels and the configured set. Without this,
  // every update would wipe maintainer overrides.
  if (labels.length > 0) {
    try {
      const currentLabels = existingStandingPr?.labels ?? [];
      const mergedLabels = [...new Set([...currentLabels, ...labels])];
      await octokit.rest.issues.setLabels({
        owner,
        repo,
        issue_number: prNumber,
        labels: mergedLabels,
      });
    } catch {
      warn('Failed to apply labels to standing PR (labels may not exist in the repository)');
    }
  }

  // Find existing manifest to preserve firstUpdatedAt across updates
  let firstUpdatedAt = new Date().toISOString();
  const existingManifestComment = await findManifestComment(octokit, owner, repo, prNumber);
  if (existingManifestComment) {
    try {
      const existingManifest = parseManifest(existingManifestComment.body);
      if (existingManifest.firstUpdatedAt) {
        firstUpdatedAt = existingManifest.firstUpdatedAt;
      } else {
        firstUpdatedAt = existingManifest.createdAt;
      }
    } catch {
      // Use current time if the existing manifest can't be parsed
    }
  }

  // Store manifest as a bot comment
  const manifest: StandingPRManifest = {
    schemaVersion: 2,
    versionOutput,
    releaseNotes: notesResult.releaseNotes ?? {},
    notesFiles: notesResult.files,
    createdAt: new Date().toISOString(),
    baseSha,
    notesHash,
    firstUpdatedAt,
  };

  const manifestBody = serializeManifest(manifest);
  if (existingManifestComment) {
    await octokit.rest.issues.updateComment({
      owner,
      repo,
      comment_id: existingManifestComment.id,
      body: manifestBody,
    });
  } else {
    await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: prNumber,
      body: manifestBody,
    });
  }
  success(`Manifest written to PR #${prNumber}`);

  // Post commit status check — gates determine pending vs success
  const minAge = standingPrConfig?.minAge;
  let statusState: 'success' | 'pending' = 'success';
  let statusDescription = 'Ready to merge';

  // Standing-PR label conflicts surface here as a pending check so the team notices.
  if (overrides.conflicts.length > 0) {
    statusState = 'pending';
    statusDescription = overrides.conflicts.join('; ').slice(0, 140);
  }

  if (minAge !== undefined && overrides.conflicts.length === 0) {
    const minAgeMs = parseDuration(minAge);
    if (minAgeMs === null) {
      warn(
        `ci.standingPr.minAge value "${minAge}" is not a valid duration (e.g. "6h", "30m", "1d") — gate is inactive`,
      );
    } else if (manifest.firstUpdatedAt) {
      const ageMs = Date.now() - new Date(manifest.firstUpdatedAt).getTime();
      if (ageMs < minAgeMs) {
        statusState = 'pending';
        statusDescription = `Waiting ${formatDuration(minAgeMs - ageMs)} for minAge`;
      }
    }
  }

  await postStandingPRStatusSafe(octokit, owner, repo, releaseBranchSha, statusState, statusDescription);

  return { action, prNumber, prUrl, versionOutput };
}

// Core publish logic: finds manifest on the given PR, optionally extracts user-edited
// notes from the PR body, then runs the publish step and cleans up the release branch.
export async function publishFromManifest(prNumber: number, options: StandingPROptions): Promise<ReleaseOutput | null> {
  const cwd = options.projectDir;

  const githubContext = getGitHubContext();
  if (!githubContext?.token) {
    error('No GitHub context (GITHUB_REPOSITORY or GITHUB_TOKEN) available');
    return null;
  }

  const octokit = createOctokit(githubContext.token);
  const { owner, repo } = githubContext;

  const releaseKitConfig = loadReleaseKitConfig({ cwd, configPath: options.config });
  const standingPrConfig = releaseKitConfig.ci?.standingPr;
  const releaseBranch = standingPrConfig?.branch ?? 'release/next';
  const deleteBranchOnMerge = standingPrConfig?.deleteBranchOnMerge !== false;

  // Find and parse manifest from the PR
  const manifestComment = await findManifestComment(octokit, owner, repo, prNumber);
  if (!manifestComment) {
    throw new Error(`Release manifest not found on PR #${prNumber}. Re-run 'standing-pr update' to regenerate.`);
  }

  let manifest: StandingPRManifest;
  try {
    manifest = parseManifest(manifestComment.body);
  } catch (err) {
    throw new Error(
      `Release manifest on PR #${prNumber} is invalid or incompatible. Re-run 'standing-pr update'. Details: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Warn if manifest base is no longer an ancestor of current HEAD (history may be rewritten)
  const currentSha = getHeadSha(cwd);
  try {
    execSync(`git merge-base --is-ancestor "${manifest.baseSha}" "${currentSha}"`, {
      cwd,
      stdio: 'pipe',
    });
  } catch {
    warn(
      `Manifest baseSha (${manifest.baseSha}) is not an ancestor of current HEAD (${currentSha}) — history may have been rewritten`,
    );
  }

  // If editableNotes is enabled, extract any user edits from the PR body and merge them
  // into the manifest's releaseNotes, falling back to manifest notes for missing packages.
  if (standingPrConfig?.editableNotes) {
    const { data: prData } = await octokit.rest.pulls.get({ owner, repo, pull_number: prNumber });
    if (prData.body) {
      const editableSection = extractEditableSection(prData.body);
      if (editableSection) {
        const editedNotes = parseEditedNotes(editableSection);
        const mergedNotes: Record<string, string> = { ...manifest.releaseNotes };
        for (const [pkg, notes] of Object.entries(editedNotes)) {
          mergedNotes[pkg] = notes;
        }
        for (const pkg of Object.keys(manifest.releaseNotes)) {
          if (!(pkg in editedNotes)) {
            warn(`Package '${pkg}' heading not found in edited release notes — using original notes`);
          }
        }
        manifest = { ...manifest, releaseNotes: mergedNotes };
      }
    }
  }

  info(`Publishing from manifest: ${manifest.versionOutput.updates.length} package(s)`);

  const publishOptions: ReleaseOptions = {
    config: options.config,
    dryRun: false,
    sync: false,
    skipNotes: true,
    skipPublish: false,
    skipGit: false,
    skipGitCommit: true,
    skipGithubRelease: false,
    skipVerification: false,
    json: options.json,
    verbose: options.verbose,
    quiet: options.quiet,
    projectDir: cwd,
    npmAuth: (options.npmAuth as ReleaseOptions['npmAuth']) ?? 'auto',
  };

  const publishOutput = await runPublishStep(
    manifest.versionOutput,
    publishOptions,
    manifest.releaseNotes,
    manifest.notesFiles,
  );

  success('Publish complete');

  // Cleanup: delete release branch if configured
  if (deleteBranchOnMerge) {
    deleteReleaseBranch(releaseBranch, cwd);
  }

  return {
    versionOutput: manifest.versionOutput,
    notesGenerated: false,
    releaseNotes: manifest.releaseNotes,
    publishOutput,
  };
}

export async function runStandingPRPublish(options: StandingPROptions): Promise<ReleaseOutput | null> {
  const cwd = options.projectDir;

  // Guard: verify this is triggered by the release PR being merged
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) {
    error('GITHUB_EVENT_PATH not set — standing-pr publish must run in GitHub Actions');
    return null;
  }

  let event: { pull_request?: { head?: { ref?: string }; number?: number; merged?: boolean } };
  try {
    event = JSON.parse(fs.readFileSync(eventPath, 'utf-8'));
  } catch (err) {
    error(`Failed to read GitHub event: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }

  const releaseKitConfig = loadReleaseKitConfig({ cwd, configPath: options.config });
  const standingPrConfig = releaseKitConfig.ci?.standingPr;
  const releaseBranch = standingPrConfig?.branch ?? 'release/next';

  const headRef = event.pull_request?.head?.ref;
  const merged = event.pull_request?.merged;
  const prNumber = event.pull_request?.number;

  if (!headRef || headRef !== releaseBranch) {
    info(`Skipping: merged PR head ref '${headRef}' does not match release branch '${releaseBranch}'`);
    return null;
  }

  if (!merged) {
    info('Skipping: PR was not merged');
    return null;
  }

  if (!prNumber) {
    error('Could not determine PR number from GitHub event');
    return null;
  }

  return publishFromManifest(prNumber, options);
}

export async function runStandingPRMerge(
  options: StandingPROptions,
  flags: { publish: boolean },
): Promise<ReleaseOutput | null> {
  const cwd = options.projectDir;

  const releaseKitConfig = loadReleaseKitConfig({ cwd, configPath: options.config });
  const standingPrConfig = releaseKitConfig.ci?.standingPr;
  const branch = standingPrConfig?.branch ?? 'release/next';
  const mergeMethod = (standingPrConfig?.mergeMethod ?? 'merge') as 'merge' | 'squash' | 'rebase';
  const deleteBranchOnMerge = standingPrConfig?.deleteBranchOnMerge !== false;

  const githubContext = getGitHubContext();
  if (!githubContext?.token) {
    error('No GitHub context (GITHUB_REPOSITORY or GITHUB_TOKEN) available');
    return null;
  }

  const octokit = createOctokit(githubContext.token);
  const { owner, repo } = githubContext;

  const pr = await findStandingPR(octokit, owner, repo, branch);
  if (!pr) {
    info(`No open standing PR found for branch '${branch}'`);
    return null;
  }

  info(`Merging standing PR #${pr.number} via ${mergeMethod}...`);
  try {
    await octokit.rest.pulls.merge({
      owner,
      repo,
      pull_number: pr.number,
      merge_method: mergeMethod,
    });
  } catch (err) {
    const reqErr = err as { status?: number; response?: { data?: { message?: string } } };
    if (reqErr.status === 405) {
      const reason = reqErr.response?.data?.message ?? 'unknown reason';
      throw new Error(`Cannot merge standing PR #${pr.number}: GitHub rejected the merge (${reason})`);
    }
    throw err;
  }
  success(`Standing PR #${pr.number} merged`);

  // If not publishing, delete the branch now (otherwise publishFromManifest handles it)
  if (!flags.publish && deleteBranchOnMerge) {
    deleteReleaseBranch(branch, cwd);
  }

  if (!flags.publish) {
    return null;
  }

  return publishFromManifest(pr.number, options);
}
