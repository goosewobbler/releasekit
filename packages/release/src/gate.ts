import { loadConfig as loadReleaseKitConfig } from '@releasekit/config';
import { info } from '@releasekit/core';
import { DEFAULT_LABELS, detectLabelConflicts } from './label-utils.js';
import { createOctokit, fetchPRLabels, findMergedPRsForCommit } from './preview-github.js';
import { getGitHubContext, getHeadCommitMessage, resolveScopeToTarget } from './release.js';

export interface GateOutput {
  shouldRelease: boolean;
  bump?: string;
  scope?: string;
  target?: string;
  stable?: boolean;
  labels: string[];
  prNumbers: number[];
  blocked?: boolean;
  reason?: string;
}

export interface GateOptions {
  config?: string;
  projectDir: string;
  scope?: string;
  json?: boolean;
  verbose?: boolean;
  quiet?: boolean;
}

export async function runGate(options: GateOptions): Promise<GateOutput> {
  const releaseKitConfig = await loadReleaseKitConfig({ cwd: options.projectDir, configPath: options.config });
  const ciConfig = releaseKitConfig.ci;

  // Strategy guard - gate only works with direct/manual strategies
  const releaseStrategy = ciConfig?.releaseStrategy ?? 'direct';
  if (releaseStrategy === 'standing-pr') {
    throw new Error(
      "Gate mode is not compatible with releaseStrategy: 'standing-pr'. Use 'releasekit standing-pr update' instead — see docs/ci-setup.md.",
    );
  }
  if (releaseStrategy === 'scheduled') {
    throw new Error(
      "Gate mode is not compatible with releaseStrategy: 'scheduled'. Scheduled releases are triggered by cron, not by gate checks.",
    );
  }

  // Check GitHub context
  const githubContext = getGitHubContext();
  if (!githubContext) {
    return {
      shouldRelease: false,
      labels: [],
      prNumbers: [],
      reason: 'No GitHub context available (missing GITHUB_REPOSITORY or GITHUB_SHA)',
    };
  }

  // Check GitHub token
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    return {
      shouldRelease: false,
      labels: [],
      prNumbers: [],
      reason: 'No GITHUB_TOKEN available',
    };
  }

  // Find merged PRs
  const octokit = createOctokit(token);
  const prNumbers = await findMergedPRsForCommit(octokit, githubContext.owner, githubContext.repo, githubContext.sha);

  if (prNumbers.length === 0) {
    info('No merged PRs found for commit');
    return {
      shouldRelease: false,
      labels: [],
      prNumbers: [],
      reason: 'No merged PRs found for this commit',
    };
  }

  // Collect per-PR labels for conflict detection
  // Note: Sequential fetch is intentional - we need per-PR labels to detect conflicts
  // and GitHub API rate limits are per-request, not batched
  const allLabels: string[] = [];
  const perPRLabels: Map<number, string[]> = new Map();
  for (const prNumber of prNumbers) {
    const prLabels = await fetchPRLabels(octokit, githubContext.owner, githubContext.repo, prNumber);
    perPRLabels.set(prNumber, prLabels);
    allLabels.push(...prLabels);
  }

  info(`Found labels: ${allLabels.join(', ')}`);

  // Check for label conflicts per-PR
  const labelConfig = ciConfig?.labels ?? DEFAULT_LABELS;
  for (const [prNumber, prLabels] of perPRLabels) {
    const conflict = detectLabelConflicts(prLabels, labelConfig);
    if (conflict.bumpConflict) {
      return {
        shouldRelease: false,
        stable: false,
        labels: allLabels,
        prNumbers,
        blocked: true,
        reason: `PR #${prNumber} has conflicting bump labels: ${conflict.bumpLabelsPresent.join(', ')}`,
      };
    }
    if (conflict.prereleaseConflict) {
      return {
        shouldRelease: false,
        stable: false,
        labels: allLabels,
        prNumbers,
        blocked: true,
        reason: `PR #${prNumber} has conflicting release labels: release:stable + release:prerelease`,
      };
    }
  }

  // Resolve scope from --scope flag
  let resolvedScope: string | undefined;
  let resolvedTarget: string | undefined;
  if (options.scope) {
    if (!ciConfig?.scopeLabels || Object.keys(ciConfig.scopeLabels).length === 0) {
      throw new Error(`--scope "${options.scope}" provided but ci.scopeLabels is not configured`);
    }
    resolvedTarget = resolveScopeToTarget(options.scope, ciConfig.scopeLabels);
    resolvedScope = options.scope;
    info(`Scope "${options.scope}" resolved to target: ${resolvedTarget}`);
  }

  // Detect bump from labels using labelConfig
  const bump = detectBumpFromLabels(allLabels, labelConfig);

  // Determine shouldRelease based on trigger mode
  const releaseTrigger = ciConfig?.releaseTrigger ?? 'label';
  let shouldRelease = false;
  let reason: string | undefined;

  let isStable = false;

  if (releaseTrigger === 'label') {
    // Label mode: release only if configured bump labels or release:stable are present
    const hasBumpLabel = allLabels.some(
      (l) => l === labelConfig.major || l === labelConfig.minor || l === labelConfig.patch,
    );
    const hasStableLabel = allLabels.includes(labelConfig.stable);
    const hasPrereleaseLabel = allLabels.includes(labelConfig.prerelease);

    if (hasBumpLabel || hasStableLabel) {
      shouldRelease = true;
      isStable = hasStableLabel && !hasPrereleaseLabel;
      reason = hasStableLabel ? `${labelConfig.stable} label found` : `bump label found: ${bump}`;
    } else if (hasPrereleaseLabel) {
      // Prerelease alone doesn't trigger release - needs bump label
      shouldRelease = false;
      reason = `${labelConfig.prerelease} requires a bump:* label`;
    } else {
      shouldRelease = false;
      reason = `No release labels found (need bump:* or ${labelConfig.stable})`;
    }
  } else {
    // Commit mode: release unless skip label present
    const hasSkipLabel = allLabels.includes(labelConfig.skip);
    if (hasSkipLabel) {
      shouldRelease = false;
      reason = `${labelConfig.skip} label found`;
    } else {
      shouldRelease = true;
      reason = 'No skip label in commit mode - proceeding with release';
    }
  }

  // Check skipPatterns - use release.ci.skipPatterns for consistency with release.ts
  const releaseConfig = releaseKitConfig.release;
  if (shouldRelease && releaseConfig?.ci?.skipPatterns?.length) {
    const headCommit = getHeadCommitMessage(options.projectDir);
    if (headCommit) {
      const matchedPattern = releaseConfig.ci.skipPatterns.find(
        (p) => headCommit.startsWith(p) || headCommit.includes(p),
      );
      if (matchedPattern) {
        shouldRelease = false;
        reason = `Commit matches skip pattern: "${matchedPattern}"`;
      }
    }
  }

  // Resolve scope from PR labels if not already set via --scope
  if (!resolvedScope && ciConfig?.scopeLabels) {
    const scopeLabels = ciConfig.scopeLabels;
    for (const label of allLabels) {
      if (scopeLabels[label]) {
        resolvedScope = label.replace(/^scope:/, '');
        resolvedTarget = scopeLabels[label];
        info(`Scope from PR label "${label}" resolved to target: ${resolvedTarget}`);
        break;
      }
    }
  }

  return {
    shouldRelease,
    bump,
    scope: resolvedScope,
    target: resolvedTarget,
    stable: isStable,
    labels: allLabels,
    prNumbers,
    reason,
  };
}

function detectBumpFromLabels(labels: string[], labelConfig: typeof DEFAULT_LABELS): string | undefined {
  const hasPrerelease = labels.includes(labelConfig.prerelease);
  const hasStable = labels.includes(labelConfig.stable);

  // Check for release:stable (auto-detect bump from commits)
  if (hasStable) return undefined;

  // Check for release:prerelease + bump label
  if (hasPrerelease) {
    if (labels.includes(labelConfig.major)) return 'premajor';
    if (labels.includes(labelConfig.minor)) return 'preminor';
    if (labels.includes(labelConfig.patch)) return 'prepatch';
    // prerelease alone needs bump label from commits
    return 'prerelease';
  }

  // Check for bump labels alone
  if (labels.includes(labelConfig.major)) return 'major';
  if (labels.includes(labelConfig.minor)) return 'minor';
  if (labels.includes(labelConfig.patch)) return 'patch';

  return undefined;
}
