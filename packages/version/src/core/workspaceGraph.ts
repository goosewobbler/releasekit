/**
 * Build the internal dependency graph for a discovered workspace, bridging the version engine's
 * package list to the ecosystem-agnostic graph in `@releasekit/core`. Edge extraction is per
 * ecosystem; the core graph then filters each package's declared deps to workspace members.
 *
 *  - npm:   `dependencies` + `peerDependencies` keys (devDependencies excluded).
 *  - cargo: `path:` dependencies, resolved from their directory to the crate name.
 *  - pub:   not yet wired (no edges) — deferred.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Package } from '@manypkg/get-packages';
import { parseCargoToml } from '@releasekit/config';
import { buildDependencyGraph, type GraphPackage, type WorkspaceDependencyGraph } from '@releasekit/core';

function npmDeps(pkg: Package): string[] {
  const json = pkg.packageJson as { dependencies?: Record<string, string>; peerDependencies?: Record<string, string> };
  return [...Object.keys(json.dependencies ?? {}), ...Object.keys(json.peerDependencies ?? {})];
}

function cargoDeps(cargoTomlPath: string, pkgDir: string, nameByDir: Map<string, string>): string[] {
  try {
    const cargo = parseCargoToml(cargoTomlPath);
    const deps: string[] = [];
    for (const dep of Object.values(cargo.dependencies ?? {})) {
      if (dep && typeof dep === 'object' && 'path' in dep) {
        const resolved = nameByDir.get(path.resolve(pkgDir, (dep as { path: string }).path));
        if (resolved) deps.push(resolved);
      }
    }
    return deps;
  } catch {
    // Unparseable Cargo.toml — treat as having no internal edges rather than aborting the run.
    return [];
  }
}

export function buildWorkspaceGraph(packages: Package[]): WorkspaceDependencyGraph {
  // Resolve cargo `path:` deps (which point at directories) back to crate names.
  const nameByDir = new Map(packages.map((p) => [path.resolve(p.dir), p.packageJson.name]));

  const graphPackages: GraphPackage[] = packages.map((p) => {
    const hasPackageJson = fs.existsSync(path.join(p.dir, 'package.json'));
    const cargoTomlPath = path.join(p.dir, 'Cargo.toml');

    if (hasPackageJson) {
      return { name: p.packageJson.name, dir: p.dir, ecosystem: 'npm', deps: npmDeps(p) };
    }
    if (fs.existsSync(cargoTomlPath)) {
      return {
        name: p.packageJson.name,
        dir: p.dir,
        ecosystem: 'cargo',
        deps: cargoDeps(cargoTomlPath, p.dir, nameByDir),
      };
    }
    return { name: p.packageJson.name, dir: p.dir, ecosystem: 'pub', deps: [] };
  });

  return buildDependencyGraph(graphPackages);
}
