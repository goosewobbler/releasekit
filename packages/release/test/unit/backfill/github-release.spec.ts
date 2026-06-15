import { execFileSync } from 'node:child_process';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  decideReleaseUpdate,
  getReleaseBody,
  isReleaseDraft,
  NOTES_MARKER,
  withMarker,
} from '../../../src/backfill/github-release.js';

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }));

/** Build an execFileSync-style failure (non-zero exit) carrying stderr. */
function execError(stderr: string, code?: string): Error {
  return Object.assign(new Error('Command failed'), { status: 1, stderr, code });
}

describe('decideReleaseUpdate', () => {
  it('should skip when no release exists for the tag', () => {
    expect(decideReleaseUpdate(null, false)).toEqual({ action: 'skip', reason: 'no-release' });
    expect(decideReleaseUpdate(null, true)).toEqual({ action: 'skip', reason: 'no-release' });
  });

  it('should update empty or already-marked bodies in default mode, and non-empty bodies under --only-missing', () => {
    // Empty bodies are always treated as gaps.
    expect(decideReleaseUpdate('', false)).toEqual({ action: 'update' });
    expect(decideReleaseUpdate('', true)).toEqual({ action: 'update' });
    // Under --only-missing, non-empty unmarked bodies are still updated (they haven't been backfilled yet).
    expect(decideReleaseUpdate('## What changed\n- auto stuff', true)).toEqual({ action: 'update' });
  });

  it('should skip an already-marked body only under --only-missing', () => {
    const marked = withMarker('- some note');
    expect(decideReleaseUpdate(marked, true)).toEqual({ action: 'skip', reason: 'already-backfilled' });
    // Default (force-refresh) run rewrites even bodies we authored before.
    expect(decideReleaseUpdate(marked, false)).toEqual({ action: 'update' });
  });

  it('should skip hand-edited (non-empty, unmarked) bodies in default mode', () => {
    const handEdited = 'My custom notes about this release';
    expect(decideReleaseUpdate(handEdited, false, false)).toEqual({
      action: 'skip',
      reason: 'hand-edited',
    });
  });

  it('should not skip hand-edited bodies when --force is passed', () => {
    const handEdited = 'My custom notes about this release';
    expect(decideReleaseUpdate(handEdited, false, true)).toEqual({ action: 'update' });
  });

  it('should not skip hand-edited bodies under --only-missing even without --force', () => {
    const handEdited = 'My custom notes about this release';
    expect(decideReleaseUpdate(handEdited, true, false)).toEqual({ action: 'update' });
  });

  it('should treat whitespace-only bodies as empty', () => {
    expect(decideReleaseUpdate('   ', false, false)).toEqual({ action: 'update' });
    expect(decideReleaseUpdate('\n\n', false, false)).toEqual({ action: 'update' });
  });
});

describe('withMarker', () => {
  it('should prepend the marker and normalise surrounding whitespace', () => {
    expect(withMarker('  - a note  ')).toBe(`${NOTES_MARKER}\n\n- a note\n`);
  });
});

describe('getReleaseBody', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return the release body on success', () => {
    vi.mocked(execFileSync).mockReturnValue('## Notes\n- a thing\n');
    expect(getReleaseBody('v1.0.0')).toBe('## Notes\n- a thing\n');
  });

  it('should return null only for a genuinely missing release', () => {
    vi.mocked(execFileSync).mockImplementation(() => {
      throw execError('release not found\n');
    });
    expect(getReleaseBody('v9.9.9')).toBeNull();
  });

  it('should throw a clear error when gh is not installed', () => {
    vi.mocked(execFileSync).mockImplementation(() => {
      throw execError('', 'ENOENT');
    });
    expect(() => getReleaseBody('v1.0.0')).toThrow(/GitHub CLI .* not found/);
  });

  it('should surface auth/network failures instead of reporting "no release"', () => {
    vi.mocked(execFileSync).mockImplementation(() => {
      throw execError('gh: Bad credentials (HTTP 401)\n');
    });
    expect(() => getReleaseBody('v1.0.0')).toThrow(/Bad credentials/);
  });
});

describe('isReleaseDraft', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return true for draft releases', () => {
    vi.mocked(execFileSync).mockReturnValue('true');
    expect(isReleaseDraft('v1.0.0')).toBe(true);
  });

  it('should return false for published releases', () => {
    vi.mocked(execFileSync).mockReturnValue('false');
    expect(isReleaseDraft('v1.0.0')).toBe(false);
  });

  it('should return false when no release exists for the tag', () => {
    vi.mocked(execFileSync).mockImplementation(() => {
      throw execError('release not found\n');
    });
    expect(isReleaseDraft('v9.9.9')).toBe(false);
  });

  it('should throw for non-not-found errors', () => {
    vi.mocked(execFileSync).mockImplementation(() => {
      throw execError('gh: Bad credentials (HTTP 401)\n');
    });
    expect(() => isReleaseDraft('v1.0.0')).toThrow();
  });
});
