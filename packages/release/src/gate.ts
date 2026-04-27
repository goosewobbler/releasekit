import type { CIConfig, ReleaseKitConfig } from '@releasekit/config';
import { loadConfig as loadReleaseKitConfig } from '@releasekit/config';
import { info, warn } from '@releasekit/core';
import { DEFAULT_LABELS, type LabelConfig } from './label-utils.js';
import { evaluatePR, type PREvaluation } from './per-pr-evaluation.js';
import { createOctokit, fetchPRLabels, findMergedPRsSinceLastRelease, postOrUpdateComment } from './preview-github.js';
import { getGitHubContext, getHeadCommitMessage, resolveScopeToTarget } from './release.js';

/**
 * Distinct comment marker for gate-notify comments. Kept separate from the preview marker
 * (`<!-- releasekit-preview -->`) so the two surfaces don't overwrite each other.
 */
const NOTIFY_MARKER = '<!-- releasekit-gate-notify -->';

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
  /**
   * Per-PR verdicts. The gate evaluates each PR independently — labels are NEVER unioned.
   * This array reflects every PR found in the window since the last release tag.
   */
  evaluations?: PREvaluation[];
}

export interface GateOptions {
  config?: string;
  projectDir: string;
  scope?: string;
  json?: boolean;
  verbose?: boolean;
  quiet?: boolean;
  /**
   * When true (default), the gate posts a comment on PRs whose labels indicated release
   * intent but did not produce a release (e.g. `release:prerelease` without `bump:*`, or
   * conflicting bump labels). Disable for dry-runs / local scripts.
   */
  notify?: boolean;
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

  // Find merged PRs since the last release tag (not just the triggering SHA) so that
  // a labelled PR isn't silently dropped when a subsequent push (e.g. dependabot) cancels
  // the original CI run and fires the gate with a different head_sha.
  const octokit = createOctokit(token);
  const prNumbers = await findMergedPRsSinceLastRelease(
    octokit,
    githubContext.owner,
    githubContext.repo,
    options.projectDir,
  );

  if (prNumbers.length === 0) {
    info('No merged PRs found since last release');
    return {
      shouldRelease: false,
      labels: [],
      prNumbers: [],
      evaluations: [],
      reason: 'No merged PRs found since last release',
    };
  }

  const labelConfig = ciConfig?.labels ?? DEFAULT_LABELS;

  // Evaluate each PR independently. Labels are never unioned across PRs — a PR with
  // insufficient labels stays insufficient and CANNOT contaminate another PR's verdict.
  const evaluations: PREvaluation[] = [];
  for (const prNumber of prNumbers) {
    const prLabels = await fetchPRLabels(octokit, githubContext.owner, githubContext.repo, prNumber);
    evaluations.push(evaluatePR(prNumber, prLabels, labelConfig, ciConfig));
  }

  const trigger = ciConfig?.releaseTrigger ?? 'label';
  const result = computeGateResult({
    evaluations,
    prNumbers,
    options,
    ciConfig,
    releaseKitConfig,
  });

  // Notify users of PRs whose labels indicated release intent but didn't trigger one.
  // Idempotent: postOrUpdateComment finds the existing notify-marker comment and updates it.
  if (options.notify !== false) {
    await notifyInsufficientLabels(octokit, githubContext.owner, githubContext.repo, evaluations, trigger, labelConfig);
  }

  return result;
}

interface ComputeGateInput {
  evaluations: PREvaluation[];
  prNumbers: number[];
  options: GateOptions;
  ciConfig: CIConfig | undefined;
  releaseKitConfig: ReleaseKitConfig;
}

function computeGateResult(input: ComputeGateInput): GateOutput {
  const { evaluations, prNumbers, options, ciConfig, releaseKitConfig } = input;

  // Hard errors short-circuit (label conflict on a single PR)
  const blocked = evaluations.find((e) => e.blocked);
  if (blocked) {
    return {
      shouldRelease: false,
      blocked: true,
      stable: false,
      labels: blocked.labels,
      prNumbers,
      evaluations,
      reason: blocked.reason,
    };
  }

  // prNumbers is in git-log order (newest first), so the first releasable evaluation
  // is the most recently merged valid PR.
  const winner = evaluations.find((e) => e.shouldRelease);

  // Resolve scope: --scope CLI flag overrides PR-driven scope.
  let resolvedScope = winner?.scope;
  let resolvedTarget = winner?.target;
  if (options.scope) {
    if (!ciConfig?.scopeLabels || Object.keys(ciConfig.scopeLabels).length === 0) {
      throw new Error(`--scope "${options.scope}" provided but ci.scopeLabels is not configured`);
    }
    resolvedTarget = resolveScopeToTarget(options.scope, ciConfig.scopeLabels);
    resolvedScope = options.scope;
    info(`Scope "${options.scope}" resolved to target: ${resolvedTarget}`);
  } else if (winner?.scope) {
    info(`Scope from PR #${winner.prNumber} label "scope:${winner.scope}" resolved to target: ${winner.target}`);
  }

  if (!winner) {
    // Surface the most-recent PR's reason — that's the one the user is most likely
    // looking at (e.g. a merge that just landed). evaluations[0] is newest by git-log order.
    const primaryReason = evaluations[0]?.reason ?? 'No PR in window has sufficient labels to trigger a release';
    info(`No PR in window (${prNumbers.join(', ')}) has sufficient labels to trigger a release`);
    return {
      shouldRelease: false,
      stable: false,
      labels: evaluations[0]?.labels ?? [],
      prNumbers,
      evaluations,
      reason: primaryReason,
    };
  }

  // Skip-pattern check on the HEAD commit message. This is a global guard against the
  // gate firing on its own release commits (e.g. "chore: release ..."). Applied AFTER the
  // winner is picked because it depends on the head commit, not on labels.
  const releaseConfig = releaseKitConfig.release;
  if (releaseConfig?.ci?.skipPatterns?.length) {
    const headCommit = getHeadCommitMessage(options.projectDir);
    if (headCommit) {
      const matchedPattern = releaseConfig.ci.skipPatterns.find(
        (p) => headCommit.startsWith(p) || headCommit.includes(p),
      );
      if (matchedPattern) {
        return {
          shouldRelease: false,
          bump: winner.bump,
          scope: resolvedScope,
          target: resolvedTarget,
          stable: winner.stable,
          labels: winner.labels,
          prNumbers,
          evaluations,
          reason: `Commit matches skip pattern: "${matchedPattern}"`,
        };
      }
    }
  }

  info(`Found labels on winning PR #${winner.prNumber}: ${winner.labels.join(', ')}`);

  return {
    shouldRelease: true,
    bump: winner.bump,
    scope: resolvedScope,
    target: resolvedTarget,
    stable: winner.stable,
    labels: winner.labels,
    prNumbers,
    evaluations,
    reason: winner.reason,
  };
}

/**
 * Whether a non-releasing evaluation warrants a comment on the PR.
 *
 * - Always notify on hard errors (`blocked`), in any trigger mode.
 * - In `label` mode, notify when the PR had release intent but no qualifying bump.
 * - In `commit` mode, don't notify on `release:skip` — that's deliberate, not user error.
 */
function shouldNotifyPR(e: PREvaluation, trigger: 'commit' | 'label'): boolean {
  if (e.shouldRelease) return false;
  if (e.blocked) return true;
  if (!e.hasReleaseIntent) return false;
  return trigger === 'label';
}

async function notifyInsufficientLabels(
  octokit: ReturnType<typeof createOctokit>,
  owner: string,
  repo: string,
  evaluations: PREvaluation[],
  trigger: 'commit' | 'label',
  labelConfig: LabelConfig,
): Promise<void> {
  for (const e of evaluations) {
    if (!shouldNotifyPR(e, trigger)) continue;
    try {
      const body = buildNotifyBody(e, labelConfig);
      await postOrUpdateComment(octokit, owner, repo, e.prNumber, body, NOTIFY_MARKER);
      info(`Posted gate notify comment on PR #${e.prNumber}`);
    } catch (err) {
      warn(`Failed to post gate notify comment on PR #${e.prNumber}: ${err instanceof Error ? err.message : err}`);
    }
  }
}

function buildNotifyBody(e: PREvaluation, labelConfig: LabelConfig): string {
  const reason = e.reason ?? 'labels did not meet the release trigger requirements';
  return [
    NOTIFY_MARKER,
    '',
    '## ⚠️ This PR did not trigger a release',
    '',
    `**Reason:** ${reason}`,
    '',
    '### To trigger a release',
    '',
    `Add a bump label (\`${labelConfig.major}\`, \`${labelConfig.minor}\`, or \`${labelConfig.patch}\`) and re-run the release workflow.`,
    '',
    `For prereleases, combine \`${labelConfig.prerelease}\` with a bump label.`,
    '',
    '*Posted automatically by [ReleaseKit](https://github.com/goosewobbler/releasekit) gate.*',
  ].join('\n');
}
