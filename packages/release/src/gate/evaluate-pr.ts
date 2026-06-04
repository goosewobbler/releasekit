import type { CIConfig } from '@releasekit/config';
import { detectLabelConflicts, type LabelConfig } from '../label-utils.js';

/**
 * Per-PR release decision. Captures whether a single PR's labels would trigger a release,
 * the resulting bump/scope/target, and the reason for any non-releasing verdict.
 *
 * The gate evaluates each PR in isolation — labels are NEVER unioned across PRs.
 */
export interface PREvaluation {
  prNumber: number;
  labels: string[];
  shouldRelease: boolean;
  bump?: string;
  scope?: string;
  target?: string;
  stable?: boolean;
  /** Hard error: conflicting labels on the SAME PR (e.g. bump:major + bump:minor). */
  blocked?: boolean;
  reason?: string;
  /**
   * True when the PR has any release-related label (bump:*, release:*, or any configured scope:*).
   * The notifier uses this to decide whether a non-releasing verdict warrants a comment.
   * PRs with no release intent stay silent.
   */
  hasReleaseIntent: boolean;
}

/**
 * Evaluate a single PR's labels against the gate's release rules.
 *
 * In `label` trigger mode:
 *  - `bump:*` or `channel:stable` ⇒ release
 *  - `channel:prerelease` alone ⇒ NO release (requires `bump:*`)
 *  - No release labels ⇒ no release
 *  - Conflicting labels on the same PR ⇒ blocked
 *
 * In `commit` trigger mode:
 *  - `release:skip` ⇒ no release
 *  - otherwise ⇒ release
 *
 * Under the `standing-pr` release strategy (either trigger mode), the gate is the
 * immediate-release evaluator:
 *  - no `release:immediate` label ⇒ neutral (changes accumulate in the standing release PR;
 *    no conflict checks, no notify comment — feeder-PR labels are advisory there)
 *  - `release:immediate` present ⇒ evaluated against the rules above
 *
 * Scope/target are resolved from THIS PR's labels only — no cross-PR union.
 */
export function evaluatePR(
  prNumber: number,
  labels: string[],
  labelConfig: LabelConfig,
  ciConfig: CIConfig | undefined,
): PREvaluation {
  const trigger = ciConfig?.releaseTrigger ?? 'label';
  const scopeLabels = ciConfig?.scopeLabels ?? {};

  const releaseLabelNames = new Set<string>([
    labelConfig.major,
    labelConfig.minor,
    labelConfig.patch,
    labelConfig.stable,
    labelConfig.prerelease,
    labelConfig.immediate,
  ]);
  const hasScopeLabel = labels.some((l) => Boolean(scopeLabels[l]));
  const hasReleaseIntent = labels.some((l) => releaseLabelNames.has(l)) || hasScopeLabel;

  // Resolve scope from THIS PR's labels — first match wins (within this PR).
  let scope: string | undefined;
  let target: string | undefined;
  for (const label of labels) {
    if (scopeLabels[label]) {
      scope = label.replace(/^scope:/, '');
      target = scopeLabels[label];
      break;
    }
  }

  // Standing-pr strategy: merges accumulate in the standing release PR, so a PR without the
  // immediate label is neutral — not blocked, not notified. Its bump/scope labels are advisory
  // overrides for the standing PR, not errors, so conflict detection is skipped too.
  const releaseStrategy = ciConfig?.releaseStrategy ?? 'direct';
  if (releaseStrategy === 'standing-pr' && !labels.includes(labelConfig.immediate)) {
    return {
      prNumber,
      labels,
      shouldRelease: false,
      scope,
      target,
      stable: false,
      reason: `standing-pr strategy: no ${labelConfig.immediate} label — changes accumulate in the standing release PR`,
      hasReleaseIntent: false,
    };
  }

  const conflict = detectLabelConflicts(labels, labelConfig);

  // Bump conflicts only matter in label mode; in commit mode only bump:major is meaningful.
  if (trigger === 'label' && conflict.bumpConflict) {
    return {
      prNumber,
      labels,
      shouldRelease: false,
      blocked: true,
      reason: `PR #${prNumber} has conflicting bump labels: ${conflict.bumpLabelsPresent.join(', ')}`,
      hasReleaseIntent,
      scope,
      target,
    };
  }

  if (conflict.prereleaseConflict) {
    return {
      prNumber,
      labels,
      shouldRelease: false,
      blocked: true,
      reason: `PR #${prNumber} has conflicting release labels: ${labelConfig.stable} + ${labelConfig.prerelease}`,
      hasReleaseIntent,
      scope,
      target,
    };
  }

  const bump = detectBumpFromLabels(labels, labelConfig);

  if (trigger === 'label') {
    const hasBumpLabel = labels.some(
      (l) => l === labelConfig.major || l === labelConfig.minor || l === labelConfig.patch,
    );
    const hasStableLabel = labels.includes(labelConfig.stable);
    const hasPrereleaseLabel = labels.includes(labelConfig.prerelease);

    if (hasBumpLabel || hasStableLabel) {
      const isStable = hasStableLabel && !hasPrereleaseLabel;
      return {
        prNumber,
        labels,
        shouldRelease: true,
        bump,
        scope,
        target,
        stable: isStable,
        reason: hasStableLabel ? `${labelConfig.stable} label found` : `bump label found: ${bump}`,
        hasReleaseIntent,
      };
    }

    if (hasPrereleaseLabel) {
      return {
        prNumber,
        labels,
        shouldRelease: false,
        scope,
        target,
        stable: false,
        reason: `${labelConfig.prerelease} requires a bump:* label`,
        hasReleaseIntent,
      };
    }

    return {
      prNumber,
      labels,
      shouldRelease: false,
      scope,
      target,
      stable: false,
      reason: `No release labels found (need bump:* or ${labelConfig.stable})`,
      hasReleaseIntent,
    };
  }

  // Commit trigger mode
  const hasSkipLabel = labels.includes(labelConfig.skip);
  if (hasSkipLabel) {
    return {
      prNumber,
      labels,
      shouldRelease: false,
      scope,
      target,
      stable: false,
      reason: `${labelConfig.skip} label found`,
      hasReleaseIntent,
    };
  }

  return {
    prNumber,
    labels,
    shouldRelease: true,
    bump,
    scope,
    target,
    stable: false,
    reason: 'No skip label in commit mode - proceeding with release',
    hasReleaseIntent,
  };
}

function detectBumpFromLabels(labels: string[], labelConfig: LabelConfig): string | undefined {
  const hasPrerelease = labels.includes(labelConfig.prerelease);
  const hasStable = labels.includes(labelConfig.stable);

  if (hasStable) return undefined;

  if (hasPrerelease) {
    if (labels.includes(labelConfig.major)) return 'premajor';
    if (labels.includes(labelConfig.minor)) return 'preminor';
    if (labels.includes(labelConfig.patch)) return 'prepatch';
    return 'prerelease';
  }

  if (labels.includes(labelConfig.major)) return 'major';
  if (labels.includes(labelConfig.minor)) return 'minor';
  if (labels.includes(labelConfig.patch)) return 'patch';

  return undefined;
}
