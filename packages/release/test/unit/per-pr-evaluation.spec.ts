import { describe, expect, it } from 'vitest';
import { DEFAULT_LABELS } from '../../src/label-utils.js';
import { evaluatePR } from '../../src/per-pr-evaluation.js';

const labelMode = { releaseTrigger: 'label' as const };
const commitMode = { releaseTrigger: 'commit' as const };

describe('evaluatePR — label mode', () => {
  it('returns shouldRelease=false with reason when only release:prerelease is present', () => {
    const result = evaluatePR(225, ['release:prerelease', 'scope:tauri'], DEFAULT_LABELS, {
      ...labelMode,
      scopeLabels: { 'scope:tauri': '@wdio/tauri-*' },
    });
    expect(result.shouldRelease).toBe(false);
    expect(result.blocked).toBeUndefined();
    expect(result.reason).toContain('release:prerelease');
    expect(result.reason).toContain('bump');
    expect(result.hasReleaseIntent).toBe(true);
  });

  it('returns shouldRelease=true with bump=patch for bump:patch alone', () => {
    const result = evaluatePR(1, ['bump:patch'], DEFAULT_LABELS, labelMode);
    expect(result.shouldRelease).toBe(true);
    expect(result.bump).toBe('patch');
    expect(result.stable).toBe(false);
  });

  it('returns shouldRelease=true with bump=minor for bump:minor alone', () => {
    const result = evaluatePR(1, ['bump:minor'], DEFAULT_LABELS, labelMode);
    expect(result.shouldRelease).toBe(true);
    expect(result.bump).toBe('minor');
  });

  it('returns shouldRelease=true with bump=major for bump:major alone', () => {
    const result = evaluatePR(1, ['bump:major'], DEFAULT_LABELS, labelMode);
    expect(result.shouldRelease).toBe(true);
    expect(result.bump).toBe('major');
  });

  it('returns shouldRelease=true with bump=preminor for bump:minor + release:prerelease', () => {
    const result = evaluatePR(1, ['bump:minor', 'release:prerelease'], DEFAULT_LABELS, labelMode);
    expect(result.shouldRelease).toBe(true);
    expect(result.bump).toBe('preminor');
    expect(result.stable).toBe(false);
  });

  it('returns shouldRelease=true with bump=premajor for bump:major + release:prerelease', () => {
    const result = evaluatePR(1, ['bump:major', 'release:prerelease'], DEFAULT_LABELS, labelMode);
    expect(result.bump).toBe('premajor');
  });

  it('returns shouldRelease=true with bump=prepatch for bump:patch + release:prerelease', () => {
    const result = evaluatePR(1, ['bump:patch', 'release:prerelease'], DEFAULT_LABELS, labelMode);
    expect(result.bump).toBe('prepatch');
  });

  it('returns shouldRelease=true with stable=true and bump=undefined for release:stable alone', () => {
    const result = evaluatePR(1, ['release:stable'], DEFAULT_LABELS, labelMode);
    expect(result.shouldRelease).toBe(true);
    expect(result.stable).toBe(true);
    // Stable graduation auto-detects magnitude from commits — bump intentionally undefined.
    expect(result.bump).toBeUndefined();
  });

  it('returns blocked=true for conflicting bump labels on the same PR', () => {
    const result = evaluatePR(1, ['bump:major', 'bump:minor'], DEFAULT_LABELS, labelMode);
    expect(result.blocked).toBe(true);
    expect(result.shouldRelease).toBe(false);
    expect(result.reason).toContain('major');
    expect(result.reason).toContain('minor');
  });

  it('returns blocked=true for release:stable + release:prerelease on the same PR', () => {
    const result = evaluatePR(1, ['release:stable', 'release:prerelease'], DEFAULT_LABELS, labelMode);
    expect(result.blocked).toBe(true);
    expect(result.shouldRelease).toBe(false);
    expect(result.reason).toContain('release:stable');
    expect(result.reason).toContain('release:prerelease');
  });

  it('returns shouldRelease=false (not releasable) for scope-only PR — scope label is not a trigger', () => {
    const result = evaluatePR(1, ['scope:utils'], DEFAULT_LABELS, {
      ...labelMode,
      scopeLabels: { 'scope:utils': '@wdio/native-utils' },
    });
    expect(result.shouldRelease).toBe(false);
    // Scope label still counts as release intent — user gets a notify comment.
    expect(result.hasReleaseIntent).toBe(true);
    expect(result.reason).toMatch(/no release labels|need bump|release:stable/i);
  });

  it('returns hasReleaseIntent=false when no release-related labels present', () => {
    const result = evaluatePR(1, ['enhancement', 'documentation'], DEFAULT_LABELS, labelMode);
    expect(result.shouldRelease).toBe(false);
    expect(result.hasReleaseIntent).toBe(false);
  });

  it('resolves scope and target from THIS PR labels only', () => {
    const result = evaluatePR(1, ['bump:minor', 'scope:utils'], DEFAULT_LABELS, {
      ...labelMode,
      scopeLabels: {
        'scope:utils': '@wdio/native-utils',
        'scope:tauri': '@wdio/tauri-*',
      },
    });
    expect(result.scope).toBe('utils');
    expect(result.target).toBe('@wdio/native-utils');
  });

  it('returns first matching scope when multiple scope labels present (no union)', () => {
    // The order in `labels` determines first-match. Per-PR evaluation does NOT join targets.
    const result = evaluatePR(1, ['bump:minor', 'scope:utils', 'scope:tauri'], DEFAULT_LABELS, {
      ...labelMode,
      scopeLabels: {
        'scope:utils': '@wdio/native-utils',
        'scope:tauri': '@wdio/tauri-*',
      },
    });
    expect(result.scope).toBe('utils');
    expect(result.target).toBe('@wdio/native-utils');
  });
});

describe('evaluatePR — commit mode', () => {
  it('returns shouldRelease=true when no skip label present', () => {
    const result = evaluatePR(1, ['feat'], DEFAULT_LABELS, commitMode);
    expect(result.shouldRelease).toBe(true);
    expect(result.hasReleaseIntent).toBe(false);
  });

  it('returns shouldRelease=false when release:skip label present', () => {
    const result = evaluatePR(1, ['release:skip'], DEFAULT_LABELS, commitMode);
    expect(result.shouldRelease).toBe(false);
    expect(result.reason).toContain('release:skip');
    expect(result.hasReleaseIntent).toBe(true);
  });

  it('does NOT block on conflicting bump labels in commit mode (bump:* not authoritative)', () => {
    const result = evaluatePR(1, ['bump:major', 'bump:minor'], DEFAULT_LABELS, commitMode);
    expect(result.blocked).toBeUndefined();
    expect(result.shouldRelease).toBe(true);
  });

  it('blocks on release:stable + release:prerelease conflict in commit mode', () => {
    const result = evaluatePR(1, ['release:stable', 'release:prerelease'], DEFAULT_LABELS, commitMode);
    expect(result.blocked).toBe(true);
  });
});
