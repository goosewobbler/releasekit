import { describe, expect, it } from 'vitest';
import { extractNotesRegion, NOTES_MARKER, NOTES_MARKER_END, wrapNotesRegion } from '../../src/notesRegion.js';

describe('notesRegion', () => {
  describe('wrapNotesRegion', () => {
    it('should wrap content in the opener and closer markers', () => {
      const wrapped = wrapNotesRegion('hello world');
      expect(wrapped).toBe(`${NOTES_MARKER}\n\nhello world\n\n${NOTES_MARKER_END}`);
    });

    it('should trim the content before wrapping', () => {
      expect(wrapNotesRegion('  padded  ')).toBe(`${NOTES_MARKER}\n\npadded\n\n${NOTES_MARKER_END}`);
    });

    it('should use per-package keyed markers when a key is given', () => {
      const wrapped = wrapNotesRegion('notes', '@scope/pkg');
      expect(wrapped).toBe('<!-- releasekit-notes:@scope/pkg -->\n\nnotes\n\n<!-- releasekit-notes-end:@scope/pkg -->');
    });
  });

  describe('extractNotesRegion', () => {
    it('should round-trip wrapped content', () => {
      expect(extractNotesRegion(wrapNotesRegion('the notes'))).toBe('the notes');
    });

    it('should round-trip per-package keyed content', () => {
      const body = `intro\n${wrapNotesRegion('pkg notes', '@scope/pkg')}\noutro`;
      expect(extractNotesRegion(body, '@scope/pkg')).toBe('pkg notes');
    });

    it('should return undefined when the opener is absent', () => {
      expect(extractNotesRegion('no markers here')).toBeUndefined();
    });

    it('should extract only the region, ignoring surrounding prose', () => {
      const body = `before\n${wrapNotesRegion('region body')}\nafter`;
      expect(extractNotesRegion(body)).toBe('region body');
    });

    it('should fall back to everything after a lone opener (legacy backfilled body)', () => {
      // Bodies backfilled before the closer existed carry only the opener (the old withMarker form).
      const legacy = `${NOTES_MARKER}\n\nlegacy notes\n`;
      expect(extractNotesRegion(legacy)).toBe('legacy notes');
    });

    it('should not confuse the bare opener with a keyed opener', () => {
      const keyed = wrapNotesRegion('keyed', 'pkg');
      expect(extractNotesRegion(keyed)).toBeUndefined();
    });

    it('should not match the closer as if it were the opener', () => {
      // The closer alone must not register as a region (back-compat with decideReleaseUpdate).
      expect(extractNotesRegion(NOTES_MARKER_END)).toBeUndefined();
    });
  });

  describe('marker-injection hardening', () => {
    it('should neutralize a forged end-marker so the region is not truncated on round-trip', () => {
      const malicious = 'real notes <!-- releasekit-notes-end:pkg --> LEAKED AFTER';
      const extracted = extractNotesRegion(wrapNotesRegion(malicious, 'pkg'), 'pkg');
      // The forged closer is inert (visible text), so nothing is truncated and nothing leaks past a
      // fake boundary; the sequence survives only in its neutralized form.
      expect(extracted).toContain('LEAKED AFTER');
      expect(extracted).not.toContain('<!-- releasekit-notes-end:pkg -->');
      expect(extracted).toContain('&lt;!-- releasekit-notes-end:pkg -->');
    });

    it('should neutralize a forged sibling opener so it cannot hijack another package’s notes', () => {
      // pkg-a carries a forged opener for `victim`; concatenated first (as a lower sort order would).
      const body = `${wrapNotesRegion('a-notes <!-- releasekit-notes:victim --> HIJACK', 'pkg-a')}\n${wrapNotesRegion('victim real notes', 'victim')}`;
      // victim's extraction must latch onto victim's own real opener, not the forged one in pkg-a.
      expect(extractNotesRegion(body, 'victim')).toBe('victim real notes');
    });

    it('should neutralize the bare ownership marker so prose cannot spoof the release-ownership check', () => {
      const inner = extractNotesRegion(wrapNotesRegion(`sneaky ${NOTES_MARKER} in prose`, 'pkg'), 'pkg');
      // decideReleaseUpdate keys ownership on includes(NOTES_MARKER); a smuggled bare marker is inert.
      expect(inner).not.toContain(NOTES_MARKER);
      expect(inner).toContain('&lt;!-- releasekit-notes -->');
    });
  });
});
