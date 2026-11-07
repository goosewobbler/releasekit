import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as TOML from 'smol-toml';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cargoRequirementAccepts,
  raiseCargoDependentRequirements,
  raiseRequirement,
} from '../../../src/cargo/dependentRequirements.js';
import { enableJsonOutput, flushPendingWrites, recordPendingWrite } from '../../../src/utils/jsonOutput.js';
import { log } from '../../../src/utils/logging.js';

vi.mock('../../../src/utils/logging.js');

let root: string;

function writeCrate(name: string, version: string, extra = ''): string {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  const manifest = path.join(dir, 'Cargo.toml');
  fs.writeFileSync(manifest, `[package]\nname = "${name}"\nversion = "${version}"\n${extra}`);
  return manifest;
}

function read(manifest: string): Record<string, any> {
  return TOML.parse(fs.readFileSync(manifest, 'utf-8'));
}

function released(manifest: string, version: string) {
  return { cargoTomlPath: manifest, name: path.basename(path.dirname(manifest)), version };
}

describe('raiseCargoDependentRequirements', () => {
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'rk-dependents-'));
    vi.clearAllMocks();
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("should raise a releasing dependent's requirement even when it already accepts the release", () => {
    const bridge = writeCrate('bridge', '1.1.0');
    const driver = writeCrate(
      'driver',
      '1.0.1',
      '\n[dependencies]\nbridge = { path = "../bridge", version = "1.0.0" }\n',
    );

    raiseCargoDependentRequirements([bridge, driver], [released(bridge, '1.1.0'), released(driver, '1.0.1')], false);

    expect(read(driver).dependencies.bridge).toEqual({ path: '../bridge', version: '1.1.0' });
  });

  it("should leave a dependent that isn't releasing alone while its requirement accepts the release", () => {
    const bridge = writeCrate('bridge', '1.1.0');
    const driver = writeCrate(
      'driver',
      '1.0.0',
      '\n[dependencies]\nbridge = { path = "../bridge", version = "1.0.0" }\n',
    );
    const before = fs.readFileSync(driver, 'utf-8');

    raiseCargoDependentRequirements([bridge, driver], [released(bridge, '1.1.0')], false);

    expect(fs.readFileSync(driver, 'utf-8')).toBe(before);
  });

  it("should raise a dependent that isn't releasing when its requirement rejects the release, and warn", () => {
    const bridge = writeCrate('bridge', '2.0.0');
    const driver = writeCrate(
      'driver',
      '1.0.0',
      '\n[dependencies.bridge]\npath = "../bridge"\nversion = "1.0.0-next.0"\n',
    );

    raiseCargoDependentRequirements([bridge, driver], [released(bridge, '2.0.0')], false);

    expect(read(driver).dependencies.bridge.version).toBe('2.0.0');
    expect(log).toHaveBeenCalledWith(expect.stringContaining("driver isn't releasing"), 'warning');
  });

  it('should cover build, dev and target-specific dependency tables', () => {
    const bridge = writeCrate('bridge', '2.0.0');
    const driver = writeCrate(
      'driver',
      '1.0.0',
      [
        '[build-dependencies]',
        'bridge = { path = "../bridge", version = "1" }',
        '[dev-dependencies]',
        'bridge = { path = "../bridge", version = "1" }',
        "[target.'cfg(unix)'.dependencies]",
        'bridge = { path = "../bridge", version = "1" }',
      ].join('\n'),
    );

    raiseCargoDependentRequirements([bridge, driver], [released(bridge, '2.0.0')], false);

    const manifest = read(driver);
    expect(manifest['build-dependencies'].bridge.version).toBe('2.0.0');
    expect(manifest['dev-dependencies'].bridge.version).toBe('2.0.0');
    expect(manifest.target['cfg(unix)'].dependencies.bridge.version).toBe('2.0.0');
  });

  it('should match a dependency by path, so a renamed dependency and an unrelated same-named crate are told apart', () => {
    const bridge = writeCrate('bridge', '2.0.0');
    const driver = writeCrate(
      'driver',
      '1.0.0',
      '\n[dependencies]\nlocal-bridge = { package = "bridge", path = "../bridge", version = "1" }\nserde = "1"\n',
    );

    raiseCargoDependentRequirements([bridge, driver], [released(bridge, '2.0.0')], false);

    expect(read(driver).dependencies['local-bridge'].version).toBe('2.0.0');
    expect(read(driver).dependencies.serde).toBe('1');
  });

  it("should build on a dry run's pending write rather than the manifest on disk", () => {
    enableJsonOutput(true);
    const bridge = writeCrate('bridge', '1.0.0');
    const driver = writeCrate(
      'driver',
      '1.0.0',
      '\n[dependencies]\nbridge = { path = "../bridge", version = "1.0.0" }\n',
    );
    recordPendingWrite(driver, fs.readFileSync(driver, 'utf-8').replace('version = "1.0.0"\n', 'version = "1.0.1"\n'));

    raiseCargoDependentRequirements([bridge, driver], [released(bridge, '1.1.0'), released(driver, '1.0.1')], true);
    flushPendingWrites();

    expect(read(driver).package.version).toBe('1.0.1');
    expect(read(driver).dependencies.bridge.version).toBe('1.1.0');
  });
});

describe('cargoRequirementAccepts', () => {
  it.each([
    ['1.0.0', '1.4.0', true],
    ['1.0.0', '2.0.0', false],
    ['0.2.0', '0.3.0', false],
    ['^1.0.0-next.0', '1.0.0-next.3', true],
    ['1.0.0-next.0', '1.1.0-next.0', false],
    ['>=1.0.0, <3', '2.5.0', true],
    ['=1.0.0', '1.0.1', false],
    ['~1.2', '1.2.9', true],
  ])('should read "%s" against %s as %s', (requirement, version, accepts) => {
    expect(cargoRequirementAccepts(requirement, version)).toBe(accepts);
  });
});

describe('raiseRequirement', () => {
  it.each([
    ['1.0.0', '1.1.0', '1.1.0'],
    ['^1.0', '1.1.0', '^1.1.0'],
    ['~1.0.0', '1.0.5', '~1.0.5'],
    ['=1.0.0', '1.1.0', '=1.1.0'],
    ['>=1.0.0, <3', '2.0.0', '2.0.0'],
    ['1.*', '2.0.0', '2.0.0'],
  ])('should raise "%s" to %s as "%s"', (requirement, version, raised) => {
    expect(raiseRequirement(requirement, version)).toBe(raised);
  });
});
