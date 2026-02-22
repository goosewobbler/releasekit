import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { extractPathDeps, parseCargoToml, updateCargoVersion } from '../../../src/utils/cargo.js';

describe('cargo utilities', () => {
  const tmpDirs: string[] = [];

  function createTmpDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'releasekit-cargo-util-test-'));
    tmpDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const dir of tmpDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
  });

  describe('parseCargoToml', () => {
    it('should parse a valid Cargo.toml', () => {
      const dir = createTmpDir();
      const cargoPath = path.join(dir, 'Cargo.toml');
      fs.writeFileSync(cargoPath, '[package]\nname = "my-crate"\nversion = "1.0.0"\n');

      const result = parseCargoToml(cargoPath);

      expect(result.package?.name).toBe('my-crate');
      expect(result.package?.version).toBe('1.0.0');
    });

    it('should throw on non-existent file', () => {
      expect(() => parseCargoToml('/tmp/nonexistent/Cargo.toml')).toThrow();
    });
  });

  describe('updateCargoVersion', () => {
    it('should update the version in Cargo.toml', () => {
      const dir = createTmpDir();
      const cargoPath = path.join(dir, 'Cargo.toml');
      fs.writeFileSync(cargoPath, '[package]\nname = "my-crate"\nversion = "1.0.0"\n');

      updateCargoVersion(cargoPath, '2.0.0');

      const updated = parseCargoToml(cargoPath);
      expect(updated.package?.version).toBe('2.0.0');
    });

    it('should throw a CARGO_TOML_ERROR on failure', () => {
      expect(() => updateCargoVersion('/tmp/nonexistent/Cargo.toml', '1.0.0')).toThrow(
        expect.objectContaining({ code: 'CARGO_TOML_ERROR' }),
      );
    });
  });

  describe('extractPathDeps', () => {
    it('should extract path dependencies', () => {
      const dir = createTmpDir();
      const cargoPath = path.join(dir, 'Cargo.toml');
      fs.writeFileSync(
        cargoPath,
        [
          '[package]',
          'name = "my-crate"',
          'version = "1.0.0"',
          '',
          '[dependencies]',
          'serde = "1.0"',
          'local-dep = { path = "../local-dep" }',
          'another = { path = "../another", version = "0.1" }',
        ].join('\n'),
      );

      const manifest = parseCargoToml(cargoPath);
      const deps = extractPathDeps(manifest);

      expect(deps).toEqual(['../local-dep', '../another']);
    });

    it('should return empty array when no dependencies', () => {
      const dir = createTmpDir();
      const cargoPath = path.join(dir, 'Cargo.toml');
      fs.writeFileSync(cargoPath, '[package]\nname = "my-crate"\nversion = "1.0.0"\n');

      const manifest = parseCargoToml(cargoPath);
      const deps = extractPathDeps(manifest);

      expect(deps).toEqual([]);
    });
  });
});
