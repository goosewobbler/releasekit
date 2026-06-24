/**
 * Resolved version action: the *reason* a package's version landed where it did.
 *
 * This is purely additive observability (#420) — it never changes which version is resolved. It
 * surfaces, in the human summary and `--json`, the graduate-vs-bump reasoning that previously lived
 * only in DEBUG logs, so a dry run can explain *why* a version resolved as it did.
 *
 *  - `first-release`: no prior real tag — the package is releasing for the first time.
 *  - `graduated`: the prior version was a prerelease and the next version is its stable form, so a
 *    requested bump was ignored in favour of graduating the existing prerelease to stable.
 *  - `bumped`: the ordinary commit/label-driven bump.
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
  /** True when there is no prior real tag for this package (a manifest-fallback synthetic tag still counts as no tag). */
  hasNoTags: boolean;
  /** The package's discovered latest tag (consumer-facing or baseline form), or `''` when none. */
  latestTag: string;
  /** The version being released. */
  nextVersion: string;
}

/**
 * Strip any tag prefix/scope (e.g. `v`, `release/v`, `@scope/pkg@v`) off a tag and return the bare
 * semver it embeds, or `null` when none can be parsed. Mirrors the version-extraction in
 * {@link isStableTag} so graduation detection here lines up with the changelog floor's.
 */
function versionFromTag(tag: string): string | null {
  // Bounded quantifiers (not `\d+`) guard against polynomial backtracking on uncontrolled tag input
  // (CodeQL js/polynomial-redos) — real semver components never approach these lengths.
  const match = tag.match(/\d{1,16}\.\d{1,16}\.\d{1,16}(?:-[0-9A-Za-z.-]{1,256})?/);
  if (!match) return null;
  return semver.valid(match[0]);
}

/**
 * Derive the resolved version action from signals already in scope where the per-package update is
 * built. Pure and defensive: any parse failure falls back to `bumped` rather than throwing, so this
 * can never abort a version run.
 */
export function resolveVersionAction(input: VersionActionInput): VersionActionResult {
  const { hasNoTags, latestTag, nextVersion } = input;

  if (hasNoTags || !latestTag) {
    return { action: 'first-release', reason: 'First release (no prior tag).' };
  }

  const prev = versionFromTag(latestTag);

  // Graduation: the prior version was a prerelease and the next version is its stable form (same
  // major.minor.patch base, prerelease segment dropped) — a requested bump was ignored to graduate
  // the existing prerelease to stable. Fall back to `bumped` whenever the prior tag can't be parsed.
  if (prev && semver.prerelease(prev) !== null && isStableVersion(nextVersion)) {
    const prevBase = `${semver.major(prev)}.${semver.minor(prev)}.${semver.patch(prev)}`;
    const nextValid = semver.valid(nextVersion);
    if (nextValid && prevBase === nextValid) {
      return { action: 'graduated', reason: `Graduated ${prev} → ${nextVersion} (bump ignored).` };
    }
  }

  return { action: 'bumped', reason: `Bumped to ${nextVersion}.` };
}
