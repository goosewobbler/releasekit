import { describe, expect, it } from 'vitest';
import { extractMarkerRegion, markerData, wrapMarkerRegion } from '../../src/marker.js';

describe('markerData', () => {
  const field = markerData<{ n: number }>({
    open: '<!-- demo-data:',
    serialize: (v) => JSON.stringify(v),
    deserialize: (raw) => {
      try {
        const p = JSON.parse(raw);
        return typeof p.n === 'number' ? { n: p.n } : null;
      } catch {
        return null;
      }
    },
  });

  it('should round-trip a value through encode/decode, ignoring surrounding prose', () => {
    expect(field.encode({ n: 5 })).toBe('<!-- demo-data: {"n":5} -->');
    expect(field.decode(`## heading\n${field.encode({ n: 5 })}\nmore prose`)).toEqual({ n: 5 });
  });

  it('should return null when the marker is absent', () => {
    expect(field.decode('no marker here')).toBeNull();
  });

  it('should return null when the payload is malformed (deserialize rejects)', () => {
    expect(field.decode('<!-- demo-data: not-json -->')).toBeNull();
    expect(field.decode('<!-- demo-data: {"n":"x"} -->')).toBeNull();
  });

  it('should be linear (ReDoS-safe) on a long unterminated marker', () => {
    // A backtracking regex would hang here; the indexOf slice returns immediately.
    expect(field.decode(`<!-- demo-data:${'{'.repeat(100000)}`)).toBeNull();
  });

  it('should honour a custom-spaced open token (the manifest base64 shape)', () => {
    const base64 = markerData<string>({ open: '<!-- base64', serialize: (s) => s, deserialize: (s) => s || null });
    expect(base64.encode('QUJD')).toBe('<!-- base64 QUJD -->');
    expect(base64.decode('<details>\n<!-- base64 QUJD -->\n</details>')).toBe('QUJD');
  });

  it('should not latch onto a broader-prefixed marker before the real one', () => {
    // `<!-- base64 ` (with the trailing space) must skip a stray `<!-- base64url … -->` and find the
    // actual manifest marker that follows.
    const base64 = markerData<string>({ open: '<!-- base64', serialize: (s) => s, deserialize: (s) => s || null });
    expect(base64.decode('<!-- base64url not-the-manifest -->\n<!-- base64 QUJD -->')).toBe('QUJD');
  });
});

describe('marker region', () => {
  const open = '<!-- region:x -->';
  const close = '<!-- region-end:x -->';

  it('should wrap content and extract it back', () => {
    const wrapped = wrapMarkerRegion('edited notes', open, close);
    expect(extractMarkerRegion(`before\n${wrapped}\nafter`, open, close)).toBe('edited notes');
  });

  it('should return undefined when the opener is absent', () => {
    expect(extractMarkerRegion('nothing here', open, close)).toBeUndefined();
  });

  it('should fall back to everything after the opener when the closer is missing', () => {
    expect(extractMarkerRegion(`${open}\n\nlegacy body content`, open, close)).toBe('legacy body content');
  });
});
