import * as fs from 'node:fs';
import type { Package } from '@manypkg/get-packages';
import { parseCargoToml } from '@releasekit/config';
import { describe, expect, it, vi } from 'vitest';
import { buildWorkspaceGraph } from '../../../src/core/workspaceGraph.js';

vi.mock('node:fs');
vi.mock('@releasekit/config', () => ({ parseCargoToml: vi.fn() }));

function pkg(name: string, dir: string, packageJson: Record<string, unknown> = {}): Package {
  return { dir, relativeDir: dir, packageJson: { name, version: '1.0.0', ...packageJson } } as unknown as Package;
}

describe('buildWorkspaceGraph', () => {
  it('should build npm edges from dependencies + peerDependencies, excluding devDeps and externals', () => {
    vi.mocked(fs.existsSync).mockImplementation((p) => String(p).endsWith('package.json'));
    const packages = [
      pkg('core', '/ws/core'),
      pkg('types', '/ws/types'),
      pkg('app', '/ws/app', {
        dependencies: { core: '1.0.0', react: '^18' },
        peerDependencies: { types: '1.0.0' },
        devDependencies: { vitest: '1' },
      }),
    ];
    const graph = buildWorkspaceGraph(packages);
    // react is external (filtered by the core graph); vitest is a devDep (never collected).
    expect([...graph.getInternalDependencies('app')].sort()).toEqual(['core', 'types']);
  });

  it('should build cargo edges by resolving path deps to crate names', () => {
    // No package.json anywhere → cargo branch.
    vi.mocked(fs.existsSync).mockImplementation((p) => String(p).endsWith('Cargo.toml'));
    vi.mocked(parseCargoToml).mockImplementation((p) =>
      String(p).includes('plugin') ? ({ dependencies: { 'core-rs': { path: '../core-rs' } } } as never) : ({} as never),
    );
    const packages = [pkg('core-rs', '/ws/core-rs'), pkg('plugin', '/ws/plugin')];
    const graph = buildWorkspaceGraph(packages);
    expect([...graph.getInternalDependencies('plugin')]).toEqual(['core-rs']);
    expect([...graph.getInternalDependents('core-rs')]).toEqual(['plugin']);
  });
});
