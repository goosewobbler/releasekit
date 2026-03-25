import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Reads the version from the package.json nearest to the given module URL.
 * Pass `import.meta.url` from the CLI entry file so the path resolves to
 * that package's own package.json, not core's.
 */
export function readPackageVersion(importMetaUrl: string): string {
  try {
    const dir = path.dirname(fileURLToPath(importMetaUrl));
    const packageJsonPath = path.resolve(dir, '../package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')) as {
      version?: string;
    };
    return packageJson.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}
