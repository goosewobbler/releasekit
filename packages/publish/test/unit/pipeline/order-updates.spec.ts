import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getDefaultConfig } from '../../../src/config.js';
import { orderVersionUpdates } from '../../../src/pipeline/order-updates.js';
import type { PublishConfig } from '../../../src/types.js';

function withOrders(orders: { npm?: string[]; cargo?: string[]; pub?: string[] }): PublishConfig {
  const config = getDefaultConfig();
  return {
    ...config,
    npm: { ...config.npm, publishOrder: orders.npm ?? [] },
    cargo: { ...config.cargo, publishOrder: orders.cargo ?? [] },
    pub: { ...config.pub, publishOrder: orders.pub ?? [] },
  };
}

describe('orderVersionUpdates', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'rk-order-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function write(dir: string, file: string, content: string): void {
    fs.mkdirSync(path.join(root, dir), { recursive: true });
    fs.writeFileSync(path.join(root, dir, file), content);
  }

  const writeCrate = (dir: string) => write(dir, 'Cargo.toml', `[package]\nname = "${dir}"\nversion = "1.0.0"\n`);
  const writePubspec = (dir: string) => write(dir, 'pubspec.yaml', `name: ${dir}\nversion: 1.0.0\n`);
  const names = (updates: { packageName: string }[]) => updates.map((u) => u.packageName);

  it('should honour npm publishOrder', () => {
    const updates = [
      { packageName: 'app', newVersion: '2.0.0', filePath: 'app/package.json' },
      { packageName: 'core', newVersion: '2.0.0', filePath: 'core/package.json' },
    ];
    expect(names(orderVersionUpdates(updates, withOrders({ npm: ['core', 'app'] }), 'all', root))).toEqual([
      'core',
      'app',
    ]);
  });

  it('should keep an npm dependency ahead of cargo updates', () => {
    writeCrate('a');
    writeCrate('c');
    const updates = [
      { packageName: 'a', newVersion: '1.0.0', filePath: 'a/package.json' },
      { packageName: 'c', newVersion: '1.0.0', filePath: 'c/Cargo.toml' },
      { packageName: 'b', newVersion: '1.0.0', filePath: 'b/package.json' },
    ];
    const config = withOrders({ npm: ['b', 'a'], cargo: ['c', 'a'] });
    expect(names(orderVersionUpdates(updates, config, 'all', root))).toEqual(['b', 'c', 'a']);
  });

  it('should ignore cargo order when only publishing to npm', () => {
    writeCrate('a');
    writeCrate('b');
    const updates = [
      { packageName: 'a', newVersion: '1.0.0', filePath: 'a/package.json' },
      { packageName: 'b', newVersion: '1.0.0', filePath: 'b/package.json' },
    ];
    const config = withOrders({ npm: ['a', 'b'], cargo: ['b', 'a'] });
    expect(names(orderVersionUpdates(updates, config, 'npm', root))).toEqual(['a', 'b']);
    expect(names(orderVersionUpdates(updates, config, 'all', root))).toEqual(['b', 'a']);
  });

  it('should honour pub publishOrder', () => {
    writePubspec('app');
    writePubspec('core');
    const updates = [
      { packageName: 'app', newVersion: '1.0.0', filePath: 'app/pubspec.yaml' },
      { packageName: 'core', newVersion: '1.0.0', filePath: 'core/pubspec.yaml' },
    ];
    expect(names(orderVersionUpdates(updates, withOrders({ pub: ['core', 'app'] }), 'all', root))).toEqual([
      'core',
      'app',
    ]);
  });

  it('should keep a crate and a pub package that share a name', () => {
    writeCrate('foo');
    writeCrate('bar');
    write('foo-pub', 'pubspec.yaml', 'name: foo\nversion: 1.0.0\n');
    const updates = [
      { packageName: 'foo', newVersion: '1.0.0', filePath: 'foo/Cargo.toml' },
      { packageName: 'bar', newVersion: '1.0.0', filePath: 'bar/Cargo.toml' },
      { packageName: 'foo', newVersion: '1.0.0', filePath: 'foo-pub/pubspec.yaml' },
    ];
    const ordered = orderVersionUpdates(updates, withOrders({ cargo: ['bar', 'foo'] }), 'all', root);
    expect(ordered.map((u) => u.filePath)).toEqual(['bar/Cargo.toml', 'foo/Cargo.toml', 'foo-pub/pubspec.yaml']);
  });
});
