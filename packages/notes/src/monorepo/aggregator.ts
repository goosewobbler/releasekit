import * as fs from 'node:fs';
import * as path from 'node:path';
import { debug, info, success } from '@releasekit/core';
import type { TemplateContext } from '../core/types.js';
import { formatVersion, prependVersion, renderMarkdown } from '../output/markdown.js';
import { splitByPackage } from './splitter.js';

export interface MonorepoOptions {
  rootPath: string;
  packagesPath: string;
  mode: 'root' | 'packages' | 'both';
  fileName?: string;
}

/** Write a file and return true if written (not dry-run). */
function writeFile(outputPath: string, content: string, dryRun: boolean): boolean {
  if (dryRun) {
    info(`Would write to ${outputPath}`);
    debug(content);
    return false;
  }

  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(outputPath, content, 'utf-8');
  success(`Changelog written to ${outputPath}`);
  return true;
}

export function aggregateToRoot(contexts: TemplateContext[]): TemplateContext {
  const aggregated: TemplateContext = {
    packageName: 'monorepo',
    version: contexts[0]?.version ?? '0.0.0',
    previousVersion: contexts[0]?.previousVersion ?? null,
    date: new Date().toISOString().split('T')[0] ?? '',
    repoUrl: contexts[0]?.repoUrl ?? null,
    entries: [],
  };

  for (const ctx of contexts) {
    for (const entry of ctx.entries) {
      aggregated.entries.push({
        ...entry,
        scope: entry.scope ? `${ctx.packageName}/${entry.scope}` : ctx.packageName,
      });
    }
  }

  return aggregated;
}

export { splitByPackage } from './splitter.js';

export function writeMonorepoChangelogs(
  contexts: TemplateContext[],
  options: MonorepoOptions,
  config: { updateStrategy?: 'prepend' | 'regenerate' },
  dryRun: boolean,
): string[] {
  const files: string[] = [];

  if (options.mode === 'root' || options.mode === 'both') {
    const rootPath = path.join(options.rootPath, options.fileName ?? 'CHANGELOG.md');
    // Root changelog includes package names since it aggregates multiple packages
    const fmtOpts = { includePackageName: true };

    info(`Writing root changelog to ${rootPath}`);
    let rootContent: string;
    if (config.updateStrategy !== 'regenerate' && fs.existsSync(rootPath)) {
      // Build new sections and prepend to existing file
      const newSections = contexts.map((ctx) => formatVersion(ctx, fmtOpts)).join('\n');
      const existing = fs.readFileSync(rootPath, 'utf-8');
      const headerEnd = existing.indexOf('\n## ');
      if (headerEnd >= 0) {
        rootContent = `${existing.slice(0, headerEnd)}\n\n${newSections}\n${existing.slice(headerEnd + 1)}`;
      } else {
        rootContent = renderMarkdown(contexts, fmtOpts);
      }
    } else {
      rootContent = renderMarkdown(contexts, fmtOpts);
    }
    if (writeFile(rootPath, rootContent, dryRun)) {
      files.push(rootPath);
    }
  }

  if (options.mode === 'packages' || options.mode === 'both') {
    const byPackage = splitByPackage(contexts);
    const packageDirMap = buildPackageDirMap(options.rootPath, options.packagesPath);

    for (const [packageName, ctx] of byPackage) {
      const simpleName = packageName.split('/').pop();
      const packageDir =
        packageDirMap.get(packageName) ?? (simpleName ? packageDirMap.get(simpleName) : undefined) ?? null;

      if (packageDir) {
        const changelogPath = path.join(packageDir, options.fileName ?? 'CHANGELOG.md');
        info(`Writing changelog for ${packageName} to ${changelogPath}`);
        const pkgContent =
          config.updateStrategy !== 'regenerate' && fs.existsSync(changelogPath)
            ? prependVersion(changelogPath, ctx)
            : renderMarkdown([ctx]);
        if (writeFile(changelogPath, pkgContent, dryRun)) {
          files.push(changelogPath);
        }
      } else {
        info(`Could not find directory for package ${packageName}, skipping`);
      }
    }
  }

  return files;
}

function buildPackageDirMap(rootPath: string, packagesPath: string): Map<string, string> {
  const map = new Map<string, string>();
  const packagesDir = path.join(rootPath, packagesPath);

  if (!fs.existsSync(packagesDir)) {
    return map;
  }

  for (const entry of fs.readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dirPath = path.join(packagesDir, entry.name);

    // Register by directory name as fallback (lower priority)
    map.set(entry.name, dirPath);

    // Register by package.json name as primary key (overrides directory name if same)
    const packageJsonPath = path.join(dirPath, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')) as { name?: string };
        if (pkg.name) {
          map.set(pkg.name, dirPath);
        }
      } catch {}
    }
  }

  return map;
}

export function detectMonorepo(cwd: string): { isMonorepo: boolean; packagesPath: string } {
  const pnpmWorkspacesPath = path.join(cwd, 'pnpm-workspace.yaml');
  const packageJsonPath = path.join(cwd, 'package.json');

  if (fs.existsSync(pnpmWorkspacesPath)) {
    const content = fs.readFileSync(pnpmWorkspacesPath, 'utf-8');
    const packagesMatch = content.match(/packages:\s*\n\s*-\s*['"]([^'"]+)['"]/);

    if (packagesMatch?.[1]) {
      const packagesGlob = packagesMatch[1];
      const packagesPath = packagesGlob.replace(/\/?\*$/, '').replace(/\/\*\*$/, '');

      return { isMonorepo: true, packagesPath: packagesPath || 'packages' };
    }

    return { isMonorepo: true, packagesPath: 'packages' };
  }

  if (fs.existsSync(packageJsonPath)) {
    try {
      const content = fs.readFileSync(packageJsonPath, 'utf-8');
      const pkg = JSON.parse(content) as { workspaces?: string[] | { packages?: string[] } };

      if (pkg.workspaces) {
        const workspaces = Array.isArray(pkg.workspaces) ? pkg.workspaces : pkg.workspaces.packages;

        if (workspaces?.length) {
          const firstWorkspace = workspaces[0];
          if (firstWorkspace) {
            const packagesPath = firstWorkspace.replace(/\/?\*$/, '').replace(/\/\*\*$/, '');
            return { isMonorepo: true, packagesPath: packagesPath || 'packages' };
          }
        }
      }
    } catch {
      return { isMonorepo: false, packagesPath: '' };
    }
  }

  return { isMonorepo: false, packagesPath: '' };
}
