/**
 * Runs the built CLI against a temp git repo, so pubspec handling goes through real discovery and parsing.
 * Requires `pnpm build` in @releasekit/version first.
 */
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import type { VersionOutput } from '@releasekit/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { executeCliCommand, readVersionOutput } from '../utils/cli.js';
import { createConventionalCommit, initGitRepo } from '../utils/git.js';
import { createPackageJson } from '../utils/package.js';
import { cleanupTempDir, symlinkNodeModules } from '../utils/tempFixture.js';

let tempDir: string;

function write(relativePath: string, content: string) {
  const filePath = join(tempDir, relativePath);
  mkdirSync(join(filePath, '..'), { recursive: true });
  writeFileSync(filePath, content);
}

function update(output: VersionOutput, packageName: string) {
  const found = output.updates.find((u) => u.packageName === packageName);
  expect(found).toBeDefined();
  return found as VersionOutput['updates'][number];
}

function bumpedFiles(output: VersionOutput, packageName: string) {
  const root = realpathSync(tempDir);
  return (update(output, packageName).files ?? []).map((file) => relative(root, resolve(root, file)));
}

describe('pubspec.yaml versioning', () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'rk-pub-'));
    writeFileSync(join(tempDir, 'package.json'), JSON.stringify({ name: 'monorepo', version: '0.1.0', private: true }));
    write('pnpm-workspace.yaml', 'packages:\n  - "packages/*"\n');
    // A Dart workspace root has no version, so it isn't a package.
    write('pubspec.yaml', 'name: workspace\npublish_to: none\nworkspace:\n  - packages/dart_core\n');
    mkdirSync(join(tempDir, 'packages/js-lib'), { recursive: true });
    createPackageJson(join(tempDir, 'packages/js-lib'), 'js-lib');
    write('packages/dart_core/pubspec.yaml', 'name: dart_core\nversion: 0.1.0\n');
    write('packages/dart_core/lib/dart_core.dart', '// core\n');
    mkdirSync(join(tempDir, 'packages/hybrid'), { recursive: true });
    createPackageJson(join(tempDir, 'packages/hybrid'), 'hybrid');
    write('packages/hybrid/pubspec.yaml', 'name: hybrid_dart\nversion: 0.1.0\n');
    mkdirSync(join(tempDir, 'packages/app'), { recursive: true });
    createPackageJson(join(tempDir, 'packages/app'), 'app');
    write('packages/app/pubspec.yaml', 'name: app\nversion: 0.1.0+7\npublish_to: none\n');
    symlinkNodeModules(tempDir);
    initGitRepo(tempDir);
  });

  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  it('should bump only the pubspecs discovery treats as packages in sync mode', () => {
    write(
      'releasekit.config.json',
      JSON.stringify({
        version: {
          preset: 'angular',
          sync: true,
          versionPrefix: 'v',
          packageSpecificTags: true,
          tagTemplate: '${packageName}@v${version}',
        },
      }),
    );
    createConventionalCommit(tempDir, 'feat', 'add feature');

    const result = executeCliCommand('--json', tempDir);

    expect(result.status).toBe(0);
    const output = readVersionOutput(result.stdout);
    expect(update(output, 'dart_core').newVersion).toBe('0.2.0');
    expect(bumpedFiles(output, 'dart_core')).toEqual(['packages/dart_core/pubspec.yaml']);
    expect(output.tags).toContain('dart_core@v0.2.0');
    expect(bumpedFiles(output, 'hybrid')).toEqual(['packages/hybrid/package.json', 'packages/hybrid/pubspec.yaml']);
    expect(bumpedFiles(output, 'app')).toEqual(['packages/app/package.json']);
    expect(bumpedFiles(output, 'monorepo')).toEqual(['package.json']);
  });

  it('should bump a Dart group member and start from its pubspec version', () => {
    write('packages/dart_core/pubspec.yaml', 'name: dart_core\nversion: 1.0.0-next.0\n');
    write(
      'releasekit.config.json',
      JSON.stringify({
        version: {
          preset: 'angular',
          sync: false,
          versionPrefix: 'v',
          packageSpecificTags: true,
          tagTemplate: '${packageName}@v${version}',
          groups: { flutter: { packages: ['dart_core', 'js-lib'], sync: 'independent' } },
        },
      }),
    );
    write('packages/dart_core/lib/dart_core.dart', '// core feature\n');
    createConventionalCommit(tempDir, 'feat', 'add core feature', undefined, false, [
      'packages/dart_core/pubspec.yaml',
      'packages/dart_core/lib/dart_core.dart',
    ]);

    const result = executeCliCommand('--json', tempDir);

    expect(result.status).toBe(0);
    const output = readVersionOutput(result.stdout);
    const dartCore = update(output, 'dart_core');
    expect(dartCore.newVersion).toBe('1.0.0-next.1');
    expect(dartCore.tag).toBe('dart_core@v1.0.0-next.1');
    expect(bumpedFiles(output, 'dart_core')).toEqual(['packages/dart_core/pubspec.yaml']);
  });

  function asyncConfig(extra: Record<string, unknown>) {
    write(
      'releasekit.config.json',
      JSON.stringify({
        version: {
          preset: 'angular',
          sync: false,
          versionPrefix: 'v',
          packageSpecificTags: true,
          tagTemplate: '${packageName}@v${version}',
          ...extra,
        },
      }),
    );
  }

  it('should keep a pub.paths manifest as its own update and not tag a package with nothing to bump', () => {
    write('packages/hybrid/dart/pubspec.yaml', 'name: hybrid_dart_sub\nversion: 0.1.0\n');
    asyncConfig({ pub: { paths: ['dart'] } });
    write('packages/hybrid/index.js', '// hybrid feature\n');
    write('packages/dart_core/lib/dart_core.dart', '// core feature\n');
    createConventionalCommit(tempDir, 'feat', 'add features', undefined, false, [
      'packages/hybrid',
      'packages/dart_core',
    ]);

    const result = executeCliCommand('--json', tempDir);

    expect(result.status).toBe(0);
    const output = readVersionOutput(result.stdout);
    const names = output.updates.map((u) => u.packageName);
    expect(new Set(names).size).toBe(names.length);
    expect(bumpedFiles(output, 'hybrid')).toEqual(['packages/hybrid/package.json']);
    expect(bumpedFiles(output, 'hybrid_dart_sub')).toEqual(['packages/hybrid/dart/pubspec.yaml']);
    // `pub.paths` replaces dart_core's own pubspec location, and it has no `dart/`.
    expect(names).not.toContain('dart_core');
    expect(output.tags.some((tag) => tag.startsWith('dart_core@'))).toBe(false);
  });

  it('should bump a pub.paths manifest under its own name when npm versioning is off', () => {
    write('packages/hybrid/dart/pubspec.yaml', 'name: hybrid_dart_sub\nversion: 0.1.0\n');
    asyncConfig({ npm: { enabled: false }, pub: { paths: ['dart'] } });
    write('packages/hybrid/index.js', '// hybrid feature\n');
    createConventionalCommit(tempDir, 'feat', 'add hybrid feature', undefined, false, ['packages/hybrid']);

    const result = executeCliCommand('--json', tempDir);

    expect(result.status).toBe(0);
    const output = readVersionOutput(result.stdout);
    expect(output.updates.map((u) => u.packageName)).toEqual(['hybrid_dart_sub']);
    expect(bumpedFiles(output, 'hybrid_dart_sub')).toEqual(['packages/hybrid/dart/pubspec.yaml']);
    expect(output.tags).toEqual(['hybrid@v0.2.0']);
  });

  it('should fail on a pubspec beside a package.json that cannot be parsed', () => {
    write('packages/hybrid/pubspec.yaml', 'name: hybrid_dart\nversion: [unclosed\n');
    asyncConfig({});
    write('packages/hybrid/index.js', '// hybrid feature\n');
    createConventionalCommit(tempDir, 'feat', 'add hybrid feature', undefined, false, ['packages/hybrid']);

    const result = executeCliCommand('--json', tempDir);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('Cannot parse');
  });
});
