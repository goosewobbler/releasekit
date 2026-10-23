import { minimatch } from 'minimatch';
import { log } from './logger.js';

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

export function shouldMatchPackageTargets(packageName: string, targets: string[]): boolean {
  return targets.some((target) => matchesPackageTarget(packageName, target));
}

export function shouldProcessPackage(packageName: string, skip: string[] = []): boolean {
  if (skip.length === 0) {
    return true;
  }

  return !shouldMatchPackageTargets(packageName, skip);
}

/**
 * A non-boolean `private` throws rather than being guessed at: a truthy read would skip a `"private": "false"` string,
 * and `=== true` would let a `"private": "true"` string get published (irreversible).
 */
export function isPrivatePackageJson(pkgJson: { private?: unknown } | null | undefined, pkgJsonPath: string): boolean {
  const value = pkgJson?.private;
  // Absent or `null` means not private, as in npm.
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
