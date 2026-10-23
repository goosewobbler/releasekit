/**
 * Observability only - never changes which version is resolved. Explains in the human summary and
 * `--json` why a version resolved as it did.
 */

import type { VersionAction } from '@releasekit/core';
import semver from 'semver';
import { isStableVersion } from './versionUtils.js';

export type { VersionAction };

export interface VersionActionResult {
  action: VersionAction;
  reason: string;
}

export interface VersionActionInput {
  /** A manifest-fallback synthetic tag still counts as no tag. */
  hasNoTags: boolean;
  /** Consumer-facing or baseline form, or `''` when none. */
  latestTag: string;
  nextVersion: string;
}

/** Mirrors {@link isStableTag}'s extraction so graduation detection lines up with the changelog floor's. */
function versionFromTag(tag: string): string | null {
  // Bounded quantifiers (not `\d+`) guard against polynomial backtracking on uncontrolled tag input
  // (CodeQL js/polynomial-redos) - real semver components never approach these lengths.
  const match = tag.match(/\d{1,16}\.\d{1,16}\.\d{1,16}(?:-[0-9A-Za-z.-]{1,256})?/);
  if (!match) {
    return null;
  }
  return semver.valid(match[0]);
}

/** Any parse failure falls back to `bumped` rather than throwing, so this can never abort a version run. */
export function resolveVersionAction(input: VersionActionInput): VersionActionResult {
  const { hasNoTags, latestTag, nextVersion } = input;

  if (hasNoTags || !latestTag) {
    return { action: 'first-release', reason: 'First release (no prior tag).' };
  }

  const prev = versionFromTag(latestTag);

  if (prev && semver.prerelease(prev) !== null && isStableVersion(nextVersion)) {
    const prevBase = `${semver.major(prev)}.${semver.minor(prev)}.${semver.patch(prev)}`;
    const nextValid = semver.valid(nextVersion);
    if (nextValid && prevBase === nextValid) {
      return { action: 'graduated', reason: `Graduated ${prev} → ${nextVersion} (bump ignored).` };
    }
  }

  return { action: 'bumped', reason: `Bumped to ${nextVersion}.` };
}
