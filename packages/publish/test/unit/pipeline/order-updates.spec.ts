import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { orderVersionUpdates } from '../../../src/pipeline/order-updates.js';
import { orderCargoVersionUpdates } from '../../../src/registry/cargo.js';
import type { PublishConfig } from '../../../src/types.js';

const config = {
  npm: { publishOrder: [] },
  cargo: { publishOrder: [] },
} as Pick<PublishConfig, 'npm' | 'cargo'> as PublishConfig;

describe('orderVersionUpdates', () => {
  it('should leave a single update unchanged', () => {
    const updates = [{ packageName: 'a', newVersion: '1.0.0', filePath: 'packages/a/package.json' }];
    expect(orderVersionUpdates(updates, config, '/ws')).toEqual(updates);
  });

  it('should honour npm publishOrder in per-package mode', () => {
    const updates = [
      { packageName: 'app', newVersion: '2.0.0', filePath: 'packages/app/package.json', tag: 'app@v2.0.0' },
      { packageName: 'core', newVersion: '2.0.0', filePath: 'packages/core/package.json', tag: 'core@v2.0.0' },
    ];
    const ordered = orderVersionUpdates(
      updates,
      { ...config, npm: { ...config.npm, publishOrder: ['core', 'app'] } } as PublishConfig,
      '/ws',
    ).map((u) => u.packageName);
    expect(ordered).toEqual(['core', 'app']);
  });

  it('should keep an npm dependency ahead of cargo updates', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rk-order-'));
    try {
      writeCrate(root, 'a');
      writeCrate(root, 'c');
      fs.mkdirSync(path.join(root, 'b'), { recursive: true });
      const updates = [
        { packageName: 'a', newVersion: '1.0.0', filePath: 'a/package.json' },
        { packageName: 'c', newVersion: '1.0.0', filePath: 'c/Cargo.toml' },
        { packageName: 'b', newVersion: '1.0.0', filePath: 'b/package.json' },
      ];
      const ordered = orderVersionUpdates(
        updates,
        {
          ...config,
          npm: { ...config.npm, publishOrder: ['b', 'a'] },
          cargo: { ...config.cargo, publishOrder: ['c', 'a'] },
        } as PublishConfig,
        root,
      ).map((u) => u.packageName);
      expect(ordered).toEqual(['b', 'c', 'a']);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('should keep a same-named pub update when ordering crates', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rk-order-'));
    try {
      writeCrate(root, 'foo');
      const updates = [
        { packageName: 'foo', newVersion: '1.0.0', filePath: 'foo/Cargo.toml' },
        { packageName: 'bar', newVersion: '1.0.0', filePath: 'bar/Cargo.toml' },
        { packageName: 'foo', newVersion: '1.0.0', filePath: 'foo-pub/pubspec.yaml' },
      ];
      writeCrate(root, 'bar');
      const ordered = orderCargoVersionUpdates(updates, [], root).map((u) => u.filePath);
      expect(ordered).toContain('foo/Cargo.toml');
      expect(ordered).toContain('bar/Cargo.toml');
      expect(ordered).toContain('foo-pub/pubspec.yaml');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

function writeCrate(root: string, name: string): void {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'Cargo.toml'), `[package]\nname = "${name}"\nversion = "1.0.0"\n`);
}
