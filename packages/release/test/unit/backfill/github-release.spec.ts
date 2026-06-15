import { describe, expect, it } from 'vitest';
import { decideReleaseUpdate, NOTES_MARKER, withMarker } from '../../../src/backfill/github-release.js';

describe('decideReleaseUpdate', () => {
  it('should skip when no release exists for the tag', () => {
    expect(decideReleaseUpdate(null, false)).toEqual({ action: 'skip', reason: 'no-release' });
    expect(decideReleaseUpdate(null, true)).toEqual({ action: 'skip', reason: 'no-release' });
  });

  it('should update an unmarked body regardless of --only-missing', () => {
    // Empty, GitHub auto-generated, and pre-releasekit hand-written bodies all count as gaps.
    expect(decideReleaseUpdate('', false)).toEqual({ action: 'update' });
    expect(decideReleaseUpdate('', true)).toEqual({ action: 'update' });
    expect(decideReleaseUpdate('## What changed\n- auto stuff', true)).toEqual({ action: 'update' });
  });

  it('should skip an already-marked body only under --only-missing', () => {
    const marked = withMarker('- some note');
    expect(decideReleaseUpdate(marked, true)).toEqual({ action: 'skip', reason: 'already-backfilled' });
    // Default (force-refresh) run rewrites even bodies we authored before.
    expect(decideReleaseUpdate(marked, false)).toEqual({ action: 'update' });
  });
});

describe('withMarker', () => {
  it('should prepend the marker and normalise surrounding whitespace', () => {
    expect(withMarker('  - a note  ')).toBe(`${NOTES_MARKER}\n\n- a note\n`);
  });
});
