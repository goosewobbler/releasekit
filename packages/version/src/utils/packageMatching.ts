/**
 * Package matching utilities for scope-based and exact name matching
 */

import micromatch from 'micromatch';
import { log } from './logging.js';

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
  // Exact match
  if (packageName === target) {
    return true;
  }

  // Handle simple scope wildcards like "@scope/*" for backward compatibility
  if (target.startsWith('@') && target.endsWith('/*') && !target.includes('**')) {
    const scope = target.slice(0, -2); // Remove "/*"
    return packageName.startsWith(`${scope}/`);
  }

  // Handle all patterns (including complex scoped patterns) using micromatch
  try {
    return micromatch.isMatch(packageName, target, {
      dot: true,
      contains: false, // Changed to false to ensure full pattern matching
      noglobstar: false,
      bash: true,
    });
  } catch (error) {
    log(`Invalid pattern "${target}": ${error instanceof Error ? error.message : String(error)}`, 'warning');
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
  // If no skip patterns, always process
  if (skip.length === 0) {
    return true;
  }

  // Check if package matches any skip pattern
  return !shouldMatchPackageTargets(packageName, skip);
}
