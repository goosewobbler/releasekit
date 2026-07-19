import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { VersionError } from '../../../src/errors/versionError.js';
import { resolveConfinedManifestPath } from '../../../src/utils/confinedPath.js';

const repoRoot = path.resolve('/repo');
const pkgDir = path.join(repoRoot, 'packages', 'foo');

describe('resolveConfinedManifestPath', () => {
  it('should resolve a manifest inside the package directory', () => {
    const resolved = resolveConfinedManifestPath(repoRoot, pkgDir, 'rust', 'Cargo.toml');
    expect(resolved).toBe(path.join(pkgDir, 'rust', 'Cargo.toml'));
  });

  it('should resolve a sibling manifest that stays inside the repository root', () => {
    const resolved = resolveConfinedManifestPath(repoRoot, pkgDir, '../bar', 'pubspec.yaml');
    expect(resolved).toBe(path.join(repoRoot, 'packages', 'bar', 'pubspec.yaml'));
  });

  it('should reject a path that escapes the repository root via ..', () => {
    expect(() => resolveConfinedManifestPath(repoRoot, pkgDir, '../../../../other-repo/crate', 'Cargo.toml')).toThrow(
      VersionError,
    );
  });

  it('should reject an absolute path outside the repository root', () => {
    expect(() => resolveConfinedManifestPath(repoRoot, pkgDir, path.resolve('/tmp/evil'), 'Cargo.toml')).toThrow(
      /outside the repository root/,
    );
  });

  it('should raise a VersionError carrying the UNSAFE_CONFIG_PATH code', () => {
    let caught: unknown;
    try {
      resolveConfinedManifestPath(repoRoot, pkgDir, '../../..', 'Cargo.toml');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(VersionError);
    expect((caught as VersionError).code).toBe('UNSAFE_CONFIG_PATH');
  });
});
