import type { VersionPackageChangelog } from '@releasekit/core';
import { describe, expect, it } from 'vitest';
import { mergeForPreview } from '../../src/preview/merge.js';

function changelog(
  packageName: string,
  previousVersion: string | null,
  version: string,
  options: { entries?: number } = {},
): VersionPackageChangelog {
  return {
    packageName,
    version,
    previousVersion,
    revisionRange: `v${previousVersion ?? '0.0.0'}..HEAD`,
    repoUrl: null,
    entries: Array.from({ length: options.entries ?? 1 }, (_, i) => ({
      type: 'feat',
      description: `entry ${i + 1}`,
    })),
  };
}

describe('mergeForPreview', () => {
  it('returns empty array when both sides are empty', () => {
    expect(mergeForPreview([], [])).toEqual([]);
  });

  it('renders standing-only packages', () => {
    const rows = mergeForPreview([changelog('@a/notes', '1.0.0', '1.1.0')], []);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      packageName: '@a/notes',
      baseline: '1.0.0',
      standing: '1.1.0',
      afterMerge: '1.1.0',
      status: 'standing-only',
    });
    expect(rows[0]?.current).toBeUndefined();
  });

  it('renders pr-only packages', () => {
    const rows = mergeForPreview([], [changelog('@a/notes', '1.0.0', '1.0.1')]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      packageName: '@a/notes',
      current: '1.0.1',
      afterMerge: '1.0.1',
      status: 'new-from-pr',
    });
    expect(rows[0]?.standing).toBeUndefined();
  });

  it('marks unchanged when versions are equal on both sides', () => {
    const rows = mergeForPreview([changelog('@a/notes', '1.0.0', '1.1.0')], [changelog('@a/notes', '1.0.0', '1.1.0')]);
    expect(rows[0]?.status).toBe('unchanged');
    expect(rows[0]?.afterMerge).toBe('1.1.0');
  });

  it('escalates when current PR has a higher bump than the standing PR', () => {
    const rows = mergeForPreview(
      [changelog('@a/notes', '1.0.0', '1.0.1')], // standing: patch
      [changelog('@a/notes', '1.0.0', '1.1.0')], // PR: minor
    );
    expect(rows[0]).toMatchObject({
      status: 'escalated',
      standing: '1.0.1',
      current: '1.1.0',
      afterMerge: '1.1.0',
    });
  });

  it('keeps standing version when standing has higher bump than current PR', () => {
    const rows = mergeForPreview(
      [changelog('@a/notes', '1.0.0', '1.1.0')], // standing: minor
      [changelog('@a/notes', '1.0.0', '1.0.1')], // PR: patch
    );
    expect(rows[0]).toMatchObject({
      status: 'unchanged',
      standing: '1.1.0',
      current: '1.0.1',
      afterMerge: '1.1.0',
    });
  });

  it('handles a mix of overlap, escalation, and pr-only', () => {
    const rows = mergeForPreview(
      [changelog('@a/notes', '1.0.0', '1.1.0'), changelog('@a/version', '0.3.1', '0.3.2')],
      [changelog('@a/version', '0.3.1', '0.4.0'), changelog('@a/publish', '0.2.0', '0.2.1')],
    );

    expect(rows.map((r) => r.packageName)).toEqual(['@a/notes', '@a/publish', '@a/version']);

    const notes = rows.find((r) => r.packageName === '@a/notes');
    expect(notes).toMatchObject({ status: 'standing-only', afterMerge: '1.1.0' });

    const publish = rows.find((r) => r.packageName === '@a/publish');
    expect(publish).toMatchObject({ status: 'new-from-pr', afterMerge: '0.2.1' });

    const version = rows.find((r) => r.packageName === '@a/version');
    expect(version).toMatchObject({ status: 'escalated', afterMerge: '0.4.0', standing: '0.3.2' });
  });

  it('treats a stable version as higher than a prerelease of the same target', () => {
    const rows = mergeForPreview(
      [changelog('@a/notes', '1.0.0', '1.5.0-beta.1')],
      [changelog('@a/notes', '1.0.0', '1.5.0')],
    );
    expect(rows[0]).toMatchObject({ status: 'escalated', afterMerge: '1.5.0' });
  });

  it('treats a major bump as higher than a minor bump', () => {
    const rows = mergeForPreview([changelog('@a/notes', '1.0.0', '1.1.0')], [changelog('@a/notes', '1.0.0', '2.0.0')]);
    expect(rows[0]).toMatchObject({ status: 'escalated', afterMerge: '2.0.0' });
  });

  it('skips changelogs with no entries', () => {
    const empty: VersionPackageChangelog = { ...changelog('@a/notes', '1.0.0', '1.1.0'), entries: [] };
    const rows = mergeForPreview([empty], []);
    expect(rows).toEqual([]);
  });
});
