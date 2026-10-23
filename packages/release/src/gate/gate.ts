import type { CIConfig, ReleaseKitConfig } from '@releasekit/config';
import { loadConfig as loadReleaseKitConfig } from '@releasekit/config';
import { info, warn } from '@releasekit/core';
import type { Forge } from '@releasekit/forge';
import { getGitHubContext, getHeadCommitMessage, matchesSkipPattern } from '../git.js';
import { fetchPRLabels, findMergedPRsSinceLastRelease, forgeFor, postOrUpdateComment } from '../github.js';
import { DEFAULT_LABELS, type LabelConfig } from '../label-utils.js';
import { resolveScopeToTarget } from '../release.js';
import { evaluatePR, type PREvaluation } from './evaluate-pr.js';

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
  evaluations: PREvaluation[];
}

export interface GateOptions {
  config?: string;
  projectDir: string;
  scope?: string;
  json?: boolean;
  verbose?: boolean;
  quiet?: boolean;
  /** Comment on PRs whose release intent didn't produce a release; disable for dry runs and local scripts. */
  notify?: boolean;
}

export async function runGate(options: GateOptions): Promise<GateOutput> {
  const releaseKitConfig = await loadReleaseKitConfig({ cwd: options.projectDir, configPath: options.config });
  const ciConfig = releaseKitConfig.ci;

  // `sha` stands in for "are we in GitHub Actions?".
  const githubContext = getGitHubContext();
  if (!githubContext?.sha) {
    return {
      shouldRelease: false,
      labels: [],
      prNumbers: [],
      evaluations: [],
      reason: 'No GitHub context available (missing GITHUB_REPOSITORY or GITHUB_SHA)',
    };
  }

  const token = githubContext.token;
  if (!token) {
    return {
      shouldRelease: false,
      labels: [],
      prNumbers: [],
      evaluations: [],
      reason: 'No GITHUB_TOKEN available',
    };
  }

  // Since the last release tag, not just the triggering SHA: a later push (e.g. dependabot) can cancel the original
  // run and fire the gate with a different head_sha.
  const forge = forgeFor({ token, owner: githubContext.owner, repo: githubContext.repo });
  const prNumbers = await findMergedPRsSinceLastRelease(forge, options.projectDir);

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

  // Labels are never unioned across PRs, so one PR's labels can't change another's verdict.
  const evaluations = await Promise.all(
    prNumbers.map((prNumber) =>
      fetchPRLabels(forge, prNumber).then((labels) => evaluatePR(prNumber, labels, labelConfig, ciConfig)),
    ),
  );

  const trigger = ciConfig?.releaseTrigger ?? 'label';
  const result = await computeGateResult({
    evaluations,
    prNumbers,
    options,
    ciConfig,
    releaseKitConfig,
  });

  if (options.notify !== false) {
    await notifyInsufficientLabels(forge, evaluations, trigger, labelConfig);
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

async function computeGateResult(input: ComputeGateInput): Promise<GateOutput> {
  const { evaluations, prNumbers, options, ciConfig, releaseKitConfig } = input;

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
    // The newest PR's reason: the merge the user most likely just landed.
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

  // Stops the gate firing on its own release commits.
  const releaseConfig = releaseKitConfig.release;
  if (releaseConfig?.ci?.skipPatterns?.length) {
    const headCommit = await getHeadCommitMessage(options.projectDir);
    if (headCommit) {
      const matchedPattern = matchesSkipPattern(headCommit, releaseConfig.ci.skipPatterns);
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

/** In commit mode a non-release is a deliberate `release:skip`, not a user error, so only `blocked` notifies. */
function shouldNotifyPR(e: PREvaluation, trigger: 'commit' | 'label'): boolean {
  if (e.shouldRelease) {
    return false;
  }
  if (e.blocked) {
    return true;
  }
  if (!e.hasReleaseIntent) {
    return false;
  }
  return trigger === 'label';
}

async function notifyInsufficientLabels(
  forge: Forge,
  evaluations: PREvaluation[],
  trigger: 'commit' | 'label',
  labelConfig: LabelConfig,
): Promise<void> {
  await Promise.all(
    evaluations.map(async (e) => {
      if (!shouldNotifyPR(e, trigger)) {
        return;
      }
      try {
        const body = buildNotifyBody(e, labelConfig);
        await postOrUpdateComment(forge, e.prNumber, body, NOTIFY_MARKER);
        info(`Posted gate notify comment on PR #${e.prNumber}`);
      } catch (err) {
        warn(`Failed to post gate notify comment on PR #${e.prNumber}: ${err instanceof Error ? err.message : err}`);
      }
    }),
  );
}

function buildNotifyBody(e: PREvaluation, labelConfig: LabelConfig): string {
  const reason = e.reason ?? 'labels did not meet the release trigger requirements';
  const actionLines = e.blocked
    ? [
        'Remove the conflicting labels so only one bump label remains (or only one of',
        `\`${labelConfig.graduate}\` / \`${labelConfig.prerelease}\`), then re-run the release workflow.`,
      ]
    : [
        `Add a bump label (\`${labelConfig.major}\`, \`${labelConfig.minor}\`, or \`${labelConfig.patch}\`) and re-run the release workflow.`,
        '',
        `For prereleases, combine \`${labelConfig.prerelease}\` with a bump label.`,
      ];
  return [
    NOTIFY_MARKER,
    '',
    '## ⚠️ This PR did not trigger a release',
    '',
    `**Reason:** ${reason}`,
    '',
    '### To trigger a release',
    '',
    ...actionLines,
    '',
    '*Posted automatically by [ReleaseKit](https://github.com/goosewobbler/releasekit) gate.*',
  ].join('\n');
}
