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
