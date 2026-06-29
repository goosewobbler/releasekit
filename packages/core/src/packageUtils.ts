/**
 * Package utility functions for monorepo package matching and filtering
 */

import { minimatch } from 'minimatch';
import { log } from './logger.js';

/**
 * Check if a package name matches a target pattern
 * Supports:
 * - Exact matches: "@scope/package-name"
 * - Scope wildcards: "@scope/*"
 * - Path patterns: "packages/**\/*"
 * - Scoped glob patterns: "@scope/**\/*"
 * - Unscoped wildcards: "*" (matches all packages)
 */
export function matchesPackageTarget(packageName: string, target: string): boolean {
  if (packageName === target) {
    return true;
  }

  if (target.startsWith('@') && target.endsWith('/*') && !target.includes('**')) {
    const scope = target.slice(0, -2);
    return packageName.startsWith(`${scope}/`);
  }

  try {
    return minimatch(packageName, target, {
      dot: true,
    });
  } catch (error) {
    log(`Invalid pattern "${target}": ${error instanceof Error ? error.message : String(error)}`, 'warn');
    return false;
  }
}

/**
 * Check if a package name matches any of the target patterns
 */
export function shouldMatchPackageTargets(packageName: string, targets: string[]): boolean {
  return targets.some((target) => matchesPackageTarget(packageName, target));
}

/**
 * Check if a package should be processed based on skip patterns
 * Supports the same pattern matching as package targeting:
 * - Exact matches: "@scope/package-name"
 * - Scope wildcards: "@scope/*"
 * - Path patterns: "packages/**\/*"
 * - Unscoped wildcards: "*"
 */
export function shouldProcessPackage(packageName: string, skip: string[] = []): boolean {
  if (skip.length === 0) {
    return true;
  }

  return !shouldMatchPackageTargets(packageName, skip);
}

/**
 * Whether a parsed package.json marks the package private (npm refuses to publish these).
 *
 * Returns `true` ONLY for the boolean `true`. A non-boolean `private` — most insidiously the quoted
 * `"private": "true"` — is treated as a hard configuration error rather than guessed at: a truthy
 * read would silently skip a `"private": "false"` string, and a strict `=== true` read would let a
 * `"private": "true"` string slip through and get **published** (irreversible). So we throw instead.
 * This trap is npm-specific: Cargo `publish = false` (TOML boolean/array) and pub `publish_to: none`
 * (YAML string) are typed by their formats, whereas JSON gives `private` no schema guard.
 *
 * @param pkgJsonPath path to the offending package.json, used verbatim in the error so the fix is obvious.
 */
export function isPrivatePackageJson(pkgJson: { private?: unknown } | null | undefined, pkgJsonPath: string): boolean {
  const value = pkgJson?.private;
  // Absent (or JSON `null`) means not private — matches npm and both legacy read paths.
  if (value === undefined || value === null) {
    return false;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  throw new Error(
    `${pkgJsonPath}: "private" must be a boolean, got ${typeof value} ${JSON.stringify(value)}. ` +
      'Use `"private": true` (no quotes).',
  );
}
