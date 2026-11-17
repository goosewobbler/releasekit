import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getWorkspacePackageDirs, getWorkspacePackageNames, getWorkspacePackageVersions } from '../../src/index.js';
import { cleanupTempDir } from '../utils/tempFixture.js';
import { createWorkspaceRepo, writeVersionConfig } from '../utils/workspace.js';

let repo: string;
const originalCwd = process.cwd();

function write(relativePath: string, content: string) {
  mkdirSync(join(repo, relativePath, '..'), { recursive: true });
  writeFileSync(join(repo, relativePath), content);
}

async function lookups(cwd: string) {
  const [names, dirs, versions] = await Promise.all([
    getWorkspacePackageNames({ cwd }),
    getWorkspacePackageDirs({ cwd }),
    getWorkspacePackageVersions({ cwd }),
  ]);
  return { names: [...names].sort(), dirs, versions };
}

describe('workspace package lookups', () => {
  beforeEach(() => {
    repo = realpathSync(createWorkspaceRepo('rk-workspace-lookups-', { packages: { web: '@test/web' }, config: {} }));
    write('packages/engine/Cargo.toml', '[package]\nname = "engine"\nversion = "2.0.0"\n');
    write('packages/engine/src/lib.rs', '');
    write('packages/dart_core/pubspec.yaml', 'name: dart_core\nversion: 3.0.0\n');
  });

  afterEach(() => {
    cleanupTempDir(repo);
  });

  it('should return every npm, Cargo and pub package with its directory and version', async () => {
    const { names, dirs, versions } = await lookups(repo);

    expect(names).toEqual(['@test/web', 'dart_core', 'engine']);
    expect(dirs).toEqual({
      '@test/web': join(repo, 'packages/web'),
      engine: join(repo, 'packages/engine'),
      dart_core: join(repo, 'packages/dart_core'),
    });
    expect(versions).toEqual({ '@test/web': '0.1.0', engine: '2.0.0', dart_core: '3.0.0' });
  });

  it('should scope to version.packages', async () => {
    writeVersionConfig(repo, { packages: ['@test/web', 'packages/engine'] });

    const { names, dirs, versions } = await lookups(repo);

    expect(names).toEqual(['@test/web', 'engine']);
    expect(Object.keys(dirs).sort()).toEqual(names);
    expect(Object.keys(versions).sort()).toEqual(names);
  });

  it('should skip a private package unless version.packages lists it exactly', async () => {
    write(
      'packages/internal/package.json',
      JSON.stringify({ name: '@test/internal', version: '0.1.0', private: true }),
    );

    expect((await lookups(repo)).names).toEqual(['@test/web', 'dart_core', 'engine']);

    writeVersionConfig(repo, { packages: ['packages/*'] });
    expect((await lookups(repo)).names).toEqual(['@test/web', 'dart_core', 'engine']);

    writeVersionConfig(repo, { packages: ['packages/*', 'packages/internal'] });
    const { names, dirs, versions } = await lookups(repo);
    expect(names).toEqual(['@test/internal', '@test/web', 'dart_core', 'engine']);
    expect(dirs['@test/internal']).toBe(join(repo, 'packages/internal'));
    expect(versions['@test/internal']).toBe('0.1.0');
  });

  it('should read the workspace at cwd, not process.cwd()', async () => {
    writeVersionConfig(repo, { packages: ['engine'] });
    const other = realpathSync(
      createWorkspaceRepo('rk-workspace-lookups-other-', { packages: { app: '@other/app' }, config: {} }),
    );
    try {
      process.chdir(other);

      const { names, dirs, versions } = await lookups(repo);

      expect(names).toEqual(['engine']);
      expect(dirs).toEqual({ engine: join(repo, 'packages/engine') });
      expect(versions).toEqual({ engine: '2.0.0' });
    } finally {
      process.chdir(originalCwd);
      cleanupTempDir(other);
    }
  });
});
