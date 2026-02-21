/**
 * Simplified package filtering utilities
 */

import path from 'node:path';
import type { Package } from '@manypkg/get-packages';
import micromatch from 'micromatch';
import { log } from './logging.js';

/**
 * Main entry point for filtering packages based on configuration targets
 */
export function filterPackagesByConfig(packages: Package[], configTargets: string[], workspaceRoot: string): Package[] {
  if (configTargets.length === 0) {
    log('No config targets specified, returning all packages', 'debug');
    return packages;
  }

  const matchedPackages = new Set<Package>();

  for (const target of configTargets) {
    // Try both directory and package name matching for each pattern
    const dirMatches = filterByDirectoryPattern(packages, target, workspaceRoot);
    const nameMatches = filterByPackageNamePattern(packages, target);

    // Add all matches to the set (duplicates automatically handled)
    for (const pkg of dirMatches) {
      matchedPackages.add(pkg);
    }
    for (const pkg of nameMatches) {
      matchedPackages.add(pkg);
    }
  }

  return Array.from(matchedPackages);
}

/**
 * Filter packages by directory patterns
 */
function filterByDirectoryPattern(packages: Package[], pattern: string, workspaceRoot: string): Package[] {
  // Handle root directory patterns
  if (pattern === './' || pattern === '.') {
    return packages.filter((pkg) => pkg.dir === workspaceRoot);
  }

  // Normalize the pattern for cross-platform compatibility
  const normalizedPattern = pattern.replace(/\\/g, '/');

  return packages.filter((pkg) => {
    // Convert package directory to relative path from workspace root
    const relativePath = path.relative(workspaceRoot, pkg.dir);
    const normalizedRelativePath = relativePath.replace(/\\/g, '/');

    // Handle exact path matches
    if (normalizedPattern === normalizedRelativePath) {
      return true;
    }

    // Handle glob patterns
    try {
      return micromatch.isMatch(normalizedRelativePath, normalizedPattern, {
        dot: true,
        noglobstar: false,
        bash: true,
      });
    } catch (error) {
      log(
        `Invalid directory pattern "${pattern}": ${error instanceof Error ? error.message : String(error)}`,
        'warning',
      );
      return false;
    }
  });
}

/**
 * Filter packages by package name patterns
 */
function filterByPackageNamePattern(packages: Package[], pattern: string): Package[] {
  return packages.filter((pkg) => {
    if (!pkg.packageJson?.name || typeof pkg.packageJson.name !== 'string') {
      return false;
    }

    return matchesPackageNamePattern(pkg.packageJson.name, pattern);
  });
}

/**
 * Check if a package name matches a pattern
 */
function matchesPackageNamePattern(packageName: string, pattern: string): boolean {
  // Exact match
  if (packageName === pattern) {
    return true;
  }

  // Handle simple scope wildcards like "@scope/*"
  if (pattern.startsWith('@') && pattern.endsWith('/*') && !pattern.includes('**')) {
    const scope = pattern.slice(0, -2); // Remove "/*"
    return packageName.startsWith(`${scope}/`);
  }

  // Handle all other patterns using micromatch
  try {
    return micromatch.isMatch(packageName, pattern, {
      dot: true,
      contains: false,
      noglobstar: false,
      bash: true,
    });
  } catch (error) {
    log(
      `Invalid package name pattern "${pattern}": ${error instanceof Error ? error.message : String(error)}`,
      'warning',
    );
    return false;
  }
}
