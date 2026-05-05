import { describe, expect, it } from 'vitest';
import { evaluatePR } from '../../src/gate/evaluate-pr.js';
import { DEFAULT_LABELS } from '../../src/label-utils.js';

const labelMode = { releaseTrigger: 'label' as const };
const commitMode = { releaseTrigger: 'commit' as const };

describe('evaluatePR — label mode', () => {
  it('should return shouldRelease=false with reason when only channel:prerelease is present', () => {
    const result = evaluatePR(225, ['channel:prerelease', 'scope:tauri'], DEFAULT_LABELS, {
      ...labelMode,
      scopeLabels: { 'scope:tauri': '@wdio/tauri-*' },
    });
    expect(result.shouldRelease).toBe(false);
    expect(result.blocked).toBeUndefined();
    expect(result.reason).toContain('channel:prerelease');
    expect(result.reason).toContain('bump');
    expect(result.hasReleaseIntent).toBe(true);
  });

  it('should return shouldRelease=true with bump=patch for bump:patch alone', () => {
    const result = evaluatePR(1, ['bump:patch'], DEFAULT_LABELS, labelMode);
    expect(result.shouldRelease).toBe(true);
    expect(result.bump).toBe('patch');
    expect(result.stable).toBe(false);
  });

  it('should return shouldRelease=true with bump=minor for bump:minor alone', () => {
    const result = evaluatePR(1, ['bump:minor'], DEFAULT_LABELS, labelMode);
    expect(result.shouldRelease).toBe(true);
    expect(result.bump).toBe('minor');
  });

  it('should return shouldRelease=true with bump=major for bump:major alone', () => {
    const result = evaluatePR(1, ['bump:major'], DEFAULT_LABELS, labelMode);
    expect(result.shouldRelease).toBe(true);
    expect(result.bump).toBe('major');
  });

  it('should return shouldRelease=true with bump=preminor for bump:minor + channel:prerelease', () => {
    const result = evaluatePR(1, ['bump:minor', 'channel:prerelease'], DEFAULT_LABELS, labelMode);
    expect(result.shouldRelease).toBe(true);
    expect(result.bump).toBe('preminor');
    expect(result.stable).toBe(false);
  });

  it('should return shouldRelease=true with bump=premajor for bump:major + channel:prerelease', () => {
    const result = evaluatePR(1, ['bump:major', 'channel:prerelease'], DEFAULT_LABELS, labelMode);
    expect(result.bump).toBe('premajor');
  });

  it('should return shouldRelease=true with bump=prepatch for bump:patch + channel:prerelease', () => {
    const result = evaluatePR(1, ['bump:patch', 'channel:prerelease'], DEFAULT_LABELS, labelMode);
    expect(result.bump).toBe('prepatch');
  });

  it('should return shouldRelease=true with stable=true and bump=undefined for channel:stable alone', () => {
    const result = evaluatePR(1, ['channel:stable'], DEFAULT_LABELS, labelMode);
    expect(result.shouldRelease).toBe(true);
    expect(result.stable).toBe(true);
    // Stable graduation auto-detects magnitude from commits — bump intentionally undefined.
    expect(result.bump).toBeUndefined();
  });

  it('should return blocked=true for conflicting bump labels on the same PR', () => {
    const result = evaluatePR(1, ['bump:major', 'bump:minor'], DEFAULT_LABELS, labelMode);
    expect(result.blocked).toBe(true);
    expect(result.shouldRelease).toBe(false);
    expect(result.reason).toContain('major');
    expect(result.reason).toContain('minor');
  });

  it('should return blocked=true for channel:stable + channel:prerelease on the same PR', () => {
    const result = evaluatePR(1, ['channel:stable', 'channel:prerelease'], DEFAULT_LABELS, labelMode);
    expect(result.blocked).toBe(true);
    expect(result.shouldRelease).toBe(false);
    expect(result.reason).toContain('channel:stable');
    expect(result.reason).toContain('channel:prerelease');
  });

  it('should return shouldRelease=false (not releasable) for scope-only PR — scope label is not a trigger', () => {
    const result = evaluatePR(1, ['scope:utils'], DEFAULT_LABELS, {
      ...labelMode,
      scopeLabels: { 'scope:utils': '@wdio/native-utils' },
    });
    expect(result.shouldRelease).toBe(false);
    // Scope label still counts as release intent — user gets a notify comment.
    expect(result.hasReleaseIntent).toBe(true);
    expect(result.reason).toMatch(/no release labels|need bump|channel:stable/i);
  });

  it('should return hasReleaseIntent=false when no release-related labels present', () => {
    const result = evaluatePR(1, ['enhancement', 'documentation'], DEFAULT_LABELS, labelMode);
    expect(result.shouldRelease).toBe(false);
    expect(result.hasReleaseIntent).toBe(false);
  });

  it('should resolve scope and target from THIS PR labels only', () => {
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

  it('should return first matching scope when multiple scope labels present (no union)', () => {
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
  it('should return shouldRelease=true when no skip label present', () => {
    const result = evaluatePR(1, ['feat'], DEFAULT_LABELS, commitMode);
    expect(result.shouldRelease).toBe(true);
    expect(result.hasReleaseIntent).toBe(false);
  });

  it('should return shouldRelease=false when release:skip label present', () => {
    const result = evaluatePR(1, ['release:skip'], DEFAULT_LABELS, commitMode);
    expect(result.shouldRelease).toBe(false);
    expect(result.reason).toContain('release:skip');
    expect(result.hasReleaseIntent).toBe(false);
  });

  it('should NOT block on conflicting bump labels in commit mode (bump:* not authoritative)', () => {
    const result = evaluatePR(1, ['bump:major', 'bump:minor'], DEFAULT_LABELS, commitMode);
    expect(result.blocked).toBeUndefined();
    expect(result.shouldRelease).toBe(true);
  });

  it('blocks on channel:stable + channel:prerelease conflict in commit mode', () => {
    const result = evaluatePR(1, ['channel:stable', 'channel:prerelease'], DEFAULT_LABELS, commitMode);
    expect(result.blocked).toBe(true);
  });
});
