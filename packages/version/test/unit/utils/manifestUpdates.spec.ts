import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { updateNativeManifests } from '../../../src/utils/manifestUpdates.js';

vi.mock('../../../src/utils/logging.js');

describe('updateNativeManifests', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rk-native-manifests-'));
    fs.writeFileSync(
      path.join(tmp, 'Cargo.toml'),
      '[workspace]\nmembers = ["pkg"]\n\n[workspace.package]\nversion = "1.0.0"\n',
    );
    fs.mkdirSync(path.join(tmp, 'pkg'));
    fs.writeFileSync(path.join(tmp, 'pkg', 'package.json'), JSON.stringify({ name: 'pkg', version: '1.0.0' }));
    fs.writeFileSync(path.join(tmp, 'pkg', 'pubspec.yaml'), 'name: pkg\nversion: 1.0.0\n');
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("should not report a publish = false crate's inherited version as bumped", () => {
    const cargoToml = '[package]\nname = "pkg"\nversion.workspace = true\npublish = false\n';
    fs.writeFileSync(path.join(tmp, 'pkg', 'Cargo.toml'), cargoToml);

    const bumped = updateNativeManifests(path.join(tmp, 'pkg'), '1.1.0', {}, { dryRun: true, repoRoot: tmp });

    expect(bumped).toEqual([path.join(tmp, 'pkg', 'pubspec.yaml')]);
    expect(fs.readFileSync(path.join(tmp, 'pkg', 'Cargo.toml'), 'utf-8')).toBe(cargoToml);
  });
});
