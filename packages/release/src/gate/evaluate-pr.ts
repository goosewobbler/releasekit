import type { CIConfig } from '@releasekit/config';
import { composeBumpFromLabels, detectLabelConflicts, type LabelConfig } from '../label-utils.js';

export interface PREvaluation {
  prNumber: number;
  labels: string[];
  shouldRelease: boolean;
  bump?: string;
  scope?: string;
  target?: string;
  stable?: boolean;
  blocked?: boolean;
  reason?: string;
  /** Decides whether a non-releasing verdict gets a notify comment; not simply "has release labels". */
  hasReleaseIntent: boolean;
}

export function standingPRImmediateRefusal(
  prNumber: number,
  headRef: string | undefined,
  labelConfig: LabelConfig,
  ciConfig: CIConfig | undefined,
): string | undefined {
  if ((ciConfig?.releaseStrategy ?? 'direct') !== 'standing-pr') {
    return undefined;
  }
  if (headRef !== (ciConfig?.standingPr?.branch ?? 'release/next')) {
    return undefined;
  }
  return `PR #${prNumber} is the standing release PR, which publishes from its manifest; ${labelConfig.immediate} doesn't apply to it`;
}

export function evaluatePR(
  prNumber: number,
  labels: string[],
  labelConfig: LabelConfig,
  ciConfig: CIConfig | undefined,
  headRef?: string,
): PREvaluation {
  const trigger = ciConfig?.releaseTrigger ?? 'label';
  const scopeLabels = ciConfig?.scopeLabels ?? {};

  const releaseLabelNames = new Set<string>([
    labelConfig.major,
    labelConfig.minor,
    labelConfig.patch,
    labelConfig.graduate,
    labelConfig.prerelease,
    labelConfig.immediate,
  ]);
  const hasScopeLabel = labels.some((l) => Boolean(scopeLabels[l]));
  const hasReleaseIntent = labels.some((l) => releaseLabelNames.has(l)) || hasScopeLabel;

  let scope: string | undefined;
  let target: string | undefined;
  for (const label of labels) {
    if (scopeLabels[label]) {
      scope = label.replace(/^scope:/, '');
      target = scopeLabels[label];
      break;
    }
  }

  // Without the immediate label a feeder PR's labels are advisory, so it's neutral: no conflict check, no notify.
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
      // Forced false even with bump/scope labels: a feeder PR's advisory labels aren't release intent.
      hasReleaseIntent: false,
    };
  }

  const standingRefusal = standingPRImmediateRefusal(prNumber, headRef, labelConfig, ciConfig);
  if (standingRefusal) {
    return {
      prNumber,
      labels,
      shouldRelease: false,
      scope,
      target,
      stable: false,
      reason: standingRefusal,
      // The notify comment asks for a bump label, which wouldn't help: the standing PR still publishes on its own.
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
      reason: `PR #${prNumber} has conflicting release labels: ${labelConfig.graduate} + ${labelConfig.prerelease}`,
      hasReleaseIntent,
      scope,
      target,
    };
  }

  const bump = composeBumpFromLabels(labels, labelConfig);

  if (trigger === 'label') {
    const hasBumpLabel = labels.some(
      (l) => l === labelConfig.major || l === labelConfig.minor || l === labelConfig.patch,
    );
    const hasGraduateLabel = labels.includes(labelConfig.graduate);
    const hasPrereleaseLabel = labels.includes(labelConfig.prerelease);

    if (hasBumpLabel || hasGraduateLabel) {
      const isGraduation = hasGraduateLabel && !hasPrereleaseLabel;
      return {
        prNumber,
        labels,
        shouldRelease: true,
        bump,
        scope,
        target,
        stable: isGraduation,
        reason: hasGraduateLabel ? `${labelConfig.graduate} label found` : `bump label found: ${bump}`,
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
      reason: `No release labels found (need bump:* or ${labelConfig.graduate})`,
      hasReleaseIntent,
    };
  }

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
