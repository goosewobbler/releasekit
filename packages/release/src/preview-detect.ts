import * as fs from 'node:fs';
import * as path from 'node:path';

export interface PrereleaseDetection {
  isPrerelease: boolean;
  identifier?: string;
}

/**
 * Detect if current package versions are prereleases by reading package.json files.
 * Returns the first prerelease identifier found, or { isPrerelease: false }.
 */
export function detectPrerelease(packagePaths: string[], projectDir: string): PrereleaseDetection {
  const paths =
    packagePaths.length > 0
      ? packagePaths.map((p) => path.join(projectDir, p, 'package.json'))
      : [path.join(projectDir, 'package.json')];

  for (const pkgPath of paths) {
    if (!fs.existsSync(pkgPath)) continue;

    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      const result = parsePrerelease(pkg.version);
      if (result.isPrerelease) return result;
    } catch {
      // Skip unreadable package.json files
    }
  }

  return { isPrerelease: false };
}

/**
 * Parse a semver version string to extract the prerelease identifier.
 * E.g. "0.3.0-next.4" → { isPrerelease: true, identifier: "next" }
 */
export function parsePrerelease(version: string | undefined): PrereleaseDetection {
  if (!version) return { isPrerelease: false };

  const match = version.match(/-([a-zA-Z0-9]+)/);
  if (match) {
    return { isPrerelease: true, identifier: match[1] };
  }

  return { isPrerelease: false };
}
