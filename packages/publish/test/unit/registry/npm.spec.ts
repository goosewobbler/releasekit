import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { npmRegistry } from '../../../src/registry/npm.js';
import type { PipelineContext } from '../../../src/types.js';

// precheckSkip reads the on-disk package.json under ctx.cwd, so these drive it against a real temp
// file rather than a mock — the point is the `private` validation, which depends on what JSON.parse
// actually yields.
describe('npmRegistry.precheckSkip', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'rk-npm-precheck-'));
  });

  afterEach(() => {
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  const ctx = (): PipelineContext => ({ cwd }) as unknown as PipelineContext;
  const target = (overrides: { filePath?: string } = {}) => ({
    packageName: '@scope/pkg',
    version: '1.0.0',
    filePath: 'package.json',
    ...overrides,
  });

  function writePkg(pkg: Record<string, unknown>): void {
    fs.writeFileSync(path.join(cwd, 'package.json'), JSON.stringify(pkg));
  }

  it('should skip non-package.json manifests as not-npm', () => {
    expect(npmRegistry.precheckSkip(target({ filePath: 'Cargo.toml' }), ctx())).toEqual({
      reason: 'Not an npm package',
    });
  });

  it('should skip a package with "private": true', () => {
    writePkg({ name: '@scope/pkg', version: '1.0.0', private: true });
    expect(npmRegistry.precheckSkip(target(), ctx())).toEqual({ reason: 'Package is private' });
  });

  it('should treat an absent private field as publishable', () => {
    writePkg({ name: '@scope/pkg', version: '1.0.0' });
    expect(npmRegistry.precheckSkip(target(), ctx())).toBeUndefined();
  });

  it('should treat "private": false as publishable', () => {
    writePkg({ name: '@scope/pkg', version: '1.0.0', private: false });
    expect(npmRegistry.precheckSkip(target(), ctx())).toBeUndefined();
  });

  it('should throw on a quoted "private": "true" instead of swallowing it and publishing', () => {
    writePkg({ name: '@scope/pkg', version: '1.0.0', private: 'true' });
    expect(() => npmRegistry.precheckSkip(target(), ctx())).toThrow(
      '"private" must be a boolean, got string "true". Use `"private": true` (no quotes).',
    );
  });

  it('should throw on a numeric private value', () => {
    writePkg({ name: '@scope/pkg', version: '1.0.0', private: 1 });
    expect(() => npmRegistry.precheckSkip(target(), ctx())).toThrow('got number 1');
  });
});
