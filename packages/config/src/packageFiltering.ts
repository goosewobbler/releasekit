/**
 * Simplified package filtering utilities
 */

import path from 'node:path';
import type { Package } from '@manypkg/get-packages';
import { log, matchesPackageTarget as matchTarget } from '@releasekit/core';
import { minimatch } from 'minimatch';

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
    const dirMatches = filterByDirectoryPattern(packages, target, workspaceRoot);
    const nameMatches = filterByPackageNamePattern(packages, target);

    for (const pkg of dirMatches) {
      matchedPackages.add(pkg);
    }
    for (const pkg of nameMatches) {
      matchedPackages.add(pkg);
    }
  }

  return Array.from(matchedPackages).filter((pkg) => !pkg.packageJson.private);
}

function filterByDirectoryPattern(packages: Package[], pattern: string, workspaceRoot: string): Package[] {
  if (pattern === './' || pattern === '.') {
    return packages.filter((pkg) => pkg.dir === workspaceRoot);
  }

  const normalizedPattern = pattern.replace(/\\/g, '/');

  return packages.filter((pkg) => {
    const relativePath = path.relative(workspaceRoot, pkg.dir);
    const normalizedRelativePath = relativePath.replace(/\\/g, '/');

    if (normalizedPattern === normalizedRelativePath) {
      return true;
    }

    try {
      return minimatch(normalizedRelativePath, normalizedPattern, {
        dot: true,
      });
    } catch (error) {
      log(`Invalid directory pattern "${pattern}": ${error instanceof Error ? error.message : String(error)}`, 'warn');
      return false;
    }
  });
}

function filterByPackageNamePattern(packages: Package[], pattern: string): Package[] {
  return packages.filter((pkg) => {
    if (!pkg.packageJson?.name || typeof pkg.packageJson.name !== 'string') {
      return false;
    }

    return matchTarget(pkg.packageJson.name, pattern);
  });
}
