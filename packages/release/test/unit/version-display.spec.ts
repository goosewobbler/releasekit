import type { VersionOutput } from '@releasekit/core';
import { describe, expect, it } from 'vitest';
import {
  publishableUpdates,
  syncVersionDisplay,
  syncVersionRange,
  toDisplayVersion,
} from '../../src/version-display.js';

function output(overrides: Partial<VersionOutput> = {}): VersionOutput {
  return {
    dryRun: false,
    updates: [],
    changelogs: [],
    tags: [],
    ...overrides,
  };
}

describe('publishableUpdates', () => {
  it('should exclude the root lockstep bump', () => {
    const vo = output({
      updates: [
        { packageName: 'my-monorepo', newVersion: '1.1.0', filePath: 'package.json', isRoot: true },
        { packageName: '@scope/a', newVersion: '1.1.0', filePath: 'packages/a/package.json' },
        { packageName: '@scope/b', newVersion: '1.1.0', filePath: 'packages/b/package.json' },
      ],
    });
    expect(publishableUpdates(vo).map((u) => u.packageName)).toEqual(['@scope/a', '@scope/b']);
  });

  it('should return all updates when none are marked as root (pre-isRoot data)', () => {
    const vo = output({
      updates: [
        { packageName: 'my-monorepo', newVersion: '1.1.0', filePath: 'package.json' },
        { packageName: '@scope/a', newVersion: '1.1.0', filePath: 'packages/a/package.json' },
      ],
    });
    expect(publishableUpdates(vo)).toHaveLength(2);
  });

  it('should fall back to all updates when filtering would leave nothing', () => {
    const vo = output({
      updates: [{ packageName: 'my-lib', newVersion: '1.1.0', filePath: 'package.json', isRoot: true }],
    });
    expect(publishableUpdates(vo).map((u) => u.packageName)).toEqual(['my-lib']);
  });
});

describe('syncVersionDisplay', () => {
  it('should use the shared tag when no update has a per-package tag', () => {
    const vo = output({
      updates: [
        { packageName: 'my-monorepo', newVersion: '1.1.0', filePath: 'package.json', isRoot: true },
        { packageName: '@scope/a', newVersion: '1.1.0', filePath: 'packages/a/package.json' },
      ],
      tags: ['v1.1.0'],
    });
    expect(syncVersionDisplay(vo)).toBe('v1.1.0');
  });

  it('should fall back to the raw version when updates carry per-package tags', () => {
    const vo = output({
      updates: [
        { packageName: 'my-monorepo', newVersion: '1.1.0', filePath: 'package.json', isRoot: true },
        { packageName: '@scope/a', newVersion: '1.1.0', filePath: 'packages/a/package.json', tag: '@scope/a@v1.1.0' },
      ],
      tags: ['@scope/a@v1.1.0'],
    });
    expect(syncVersionDisplay(vo)).toBe('1.1.0');
  });

  it('should return an empty string for empty output', () => {
    expect(syncVersionDisplay(output())).toBe('');
  });
});

describe('toDisplayVersion', () => {
  it('should strip a package-specific tag prefix down to the bare semver', () => {
    expect(toDisplayVersion('wdio-electron-service@v10.1.0')).toBe('10.1.0');
  });

  it('should strip a plain vX.Y.Z tag', () => {
    expect(toDisplayVersion('v1.2.0')).toBe('1.2.0');
  });

  it('should strip a baseline release/v… tag', () => {
    expect(toDisplayVersion('release/v1.2.0')).toBe('1.2.0');
  });

  it('should preserve a prerelease (and build) suffix', () => {
    expect(toDisplayVersion('@scope/pkg@v1.1.0-next.0')).toBe('1.1.0-next.0');
    expect(toDisplayVersion('v2.0.0-rc.1+build.5')).toBe('2.0.0-rc.1+build.5');
  });

  it('should anchor at the tail so a numeric package name is not mistaken for the version', () => {
    expect(toDisplayVersion('package2@v1.0.0')).toBe('1.0.0');
  });

  it('should return an already-bare version unchanged', () => {
    expect(toDisplayVersion('10.2.0')).toBe('10.2.0');
  });

  it('should return the input unchanged when it carries no semver', () => {
    expect(toDisplayVersion('not-a-version')).toBe('not-a-version');
  });
});

describe('syncVersionRange', () => {
  it('should render previous → next when the previous version is known', () => {
    const vo = output({
      updates: [{ packageName: '@scope/a', newVersion: '1.1.0', filePath: 'packages/a/package.json' }],
      changelogs: [
        {
          packageName: 'monorepo',
          version: '1.1.0',
          previousVersion: 'v1.0.0',
          revisionRange: 'v1.0.0..HEAD',
          repoUrl: null,
          entries: [],
        },
      ],
      tags: ['v1.1.0'],
    });
    expect(syncVersionRange(vo)).toBe('v1.0.0 → v1.1.0');
  });

  it('should render only the next version when there is no previous version', () => {
    const vo = output({
      updates: [{ packageName: '@scope/a', newVersion: '1.1.0', filePath: 'packages/a/package.json' }],
      changelogs: [
        {
          packageName: 'monorepo',
          version: '1.1.0',
          previousVersion: null,
          revisionRange: 'HEAD',
          repoUrl: null,
          entries: [],
        },
      ],
      tags: ['v1.1.0'],
    });
    expect(syncVersionRange(vo)).toBe('v1.1.0');
  });
});
