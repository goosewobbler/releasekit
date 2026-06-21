import * as fs from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { orderNpmUpdates } from '../../../src/stages/npm-publish.js';

vi.mock('node:fs');

// core <- utils, {core,utils} <- app. Manifest dep keys match packageName so they're internal edges.
const manifests: Record<string, unknown> = {
  '/ws/packages/core/package.json': { name: 'core' },
  '/ws/packages/utils/package.json': { name: 'utils', dependencies: { core: '^1.0.0' } },
  '/ws/packages/app/package.json': { name: 'app', dependencies: { utils: '^1.0.0', core: '^1.0.0' } },
};

function update(packageName: string, filePath: string) {
  return { packageName, newVersion: '1.0.0', filePath };
}

// Deliberately not in dependency order.
const npmUpdates = [
  update('app', 'packages/app/package.json'),
  update('utils', 'packages/utils/package.json'),
  update('core', 'packages/core/package.json'),
];

describe('orderNpmUpdates', () => {
  beforeEach(() => {
    vi.mocked(fs.readFileSync).mockImplementation((p: fs.PathOrFileDescriptor) => {
      const manifest = manifests[String(p)];
      if (!manifest) throw new Error(`no manifest for ${String(p)}`);
      return JSON.stringify(manifest);
    });
  });

  it('should order npm updates dependencies-first by default', () => {
    const ordered = orderNpmUpdates(npmUpdates, [], '/ws').map((u) => u.packageName);
    expect(ordered).toEqual(['core', 'utils', 'app']);
  });

  it('should honour an explicit publishOrder over the topological sort', () => {
    const ordered = orderNpmUpdates(npmUpdates, ['app', 'core', 'utils'], '/ws').map((u) => u.packageName);
    expect(ordered).toEqual(['app', 'core', 'utils']);
  });

  it('should append npm packages missing from an explicit publishOrder', () => {
    const ordered = orderNpmUpdates(npmUpdates, ['core'], '/ws').map((u) => u.packageName);
    expect(ordered[0]).toBe('core');
    expect(ordered).toContain('utils');
    expect(ordered).toContain('app');
    expect(ordered).toHaveLength(3);
  });

  it('should keep non-npm updates and not read them as package.json', () => {
    const withCargo = [...npmUpdates, update('crate', 'crates/crate/Cargo.toml')];
    const ordered = orderNpmUpdates(withCargo, [], '/ws').map((u) => u.packageName);
    expect(ordered).toEqual(['core', 'utils', 'app', 'crate']);
  });

  it('should return a single-package list unchanged without touching git or fs ordering', () => {
    const single = [update('core', 'packages/core/package.json')];
    expect(orderNpmUpdates(single, [], '/ws')).toEqual(single);
  });
});
