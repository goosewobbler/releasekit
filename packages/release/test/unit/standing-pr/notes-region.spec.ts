import { describe, expect, it } from 'vitest';
import {
  extractNotesRegions,
  MAX_NOTES_CHARS_PER_PACKAGE,
  mergeNotesRegions,
  renderNotesRegion,
  truncatePackageNotes,
} from '../../../src/standing-pr/notes-region.js';

describe('notes-region', () => {
  describe('renderNotesRegion', () => {
    it('should render a keyed editable region per package', () => {
      const rendered = renderNotesRegion({ '@scope/a': 'Notes A', '@scope/b': 'Notes B' });

      expect(rendered).toContain('## Release Notes');
      expect(rendered).toContain('<!-- releasekit-notes:@scope/a -->');
      expect(rendered).toContain('<!-- releasekit-notes-end:@scope/a -->');
      expect(rendered).toContain('Notes A');
      expect(rendered).toContain('<!-- releasekit-notes:@scope/b -->');
      expect(rendered).toContain('Notes B');
    });

    it('should return an empty string when there are no packages', () => {
      expect(renderNotesRegion({})).toBe('');
    });

    it('should truncate oversized per-package notes at the documented bound', () => {
      const oversized = Array.from({ length: 5000 }, (_, i) => `- line ${i} of a very inflated note`).join('\n');
      const rendered = renderNotesRegion({ '@scope/a': oversized });

      // The rendered region carries a bounded slice with the truncation marker, not the whole payload.
      expect(rendered).toContain('…(truncated)');
      expect(rendered.length).toBeLessThan(oversized.length);
      // The package's editable block stays under the per-package bound (plus small marker/heading overhead).
      expect(rendered).toContain('<!-- releasekit-notes:@scope/a -->');
    });
  });

  describe('truncatePackageNotes', () => {
    it('should leave notes within the bound untouched', () => {
      const notes = 'a short note\nwith two lines';
      expect(truncatePackageNotes(notes)).toBe(notes);
    });

    it('should trim notes beyond the bound and append the truncation marker', () => {
      const oversized = 'x'.repeat(MAX_NOTES_CHARS_PER_PACKAGE + 5000);
      const truncated = truncatePackageNotes(oversized);

      expect(truncated.length).toBeLessThanOrEqual(MAX_NOTES_CHARS_PER_PACKAGE);
      expect(truncated.endsWith('…(truncated)')).toBe(true);
    });

    it('should round-trip through extractNotesRegions', () => {
      const notes = { '@scope/a': 'Notes A', pkg: 'Plain notes' };
      const rendered = renderNotesRegion(notes);

      expect(extractNotesRegions(rendered, ['@scope/a', 'pkg'])).toEqual(notes);
    });
  });

  describe('extractNotesRegions', () => {
    it('should extract only the requested packages and omit missing ones', () => {
      const body = `prose\n${renderNotesRegion({ '@scope/a': 'Notes A' })}\nmore prose`;

      expect(extractNotesRegions(body, ['@scope/a', '@scope/missing'])).toEqual({ '@scope/a': 'Notes A' });
    });

    it('should return an empty object when the body has no region', () => {
      expect(extractNotesRegions('just a normal PR body', ['pkg'])).toEqual({});
    });

    it('should preserve human edits inside the markers', () => {
      const seeded = renderNotesRegion({ pkg: 'original' });
      const edited = seeded.replace('original', 'human edited this');

      expect(extractNotesRegions(edited, ['pkg'])).toEqual({ pkg: 'human edited this' });
    });
  });

  describe('mergeNotesRegions', () => {
    it('should let edited notes win per package', () => {
      const fresh = { a: 'fresh A', b: 'fresh B' };
      const edited = { a: 'edited A' };

      expect(mergeNotesRegions(fresh, edited)).toEqual({ a: 'edited A', b: 'fresh B' });
    });

    it('should fall back to fresh notes for packages with no edit', () => {
      expect(mergeNotesRegions({ a: 'fresh A' }, {})).toEqual({ a: 'fresh A' });
    });

    it('should include edited-only packages even when fresh is empty', () => {
      expect(mergeNotesRegions({}, { a: 'edited A' })).toEqual({ a: 'edited A' });
    });
  });
});
