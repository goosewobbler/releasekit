import { describe, expect, it } from 'vitest';
import { extractMarkerRegion, markerData, neutralizeMarkers, wrapMarkerRegion } from '../../src/marker.js';

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

  it('should be linear (ReDoS-safe) scanning a long unterminated payload', () => {
    // The opener IS matched (note the space after the colon), then the closer is scanned over a
    // huge payload with no terminator. A backtracking regex would blow up here; the linear indexOf
    // for the closer returns immediately (no close → null).
    expect(field.decode(`<!-- demo-data: ${'{'.repeat(100000)}`)).toBeNull();
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

describe('neutralizeMarkers', () => {
  it('should break the comment opener of releasekit and rk markers', () => {
    expect(neutralizeMarkers('x <!-- releasekit-notes-end:pkg --> y')).toBe('x &lt;!-- releasekit-notes-end:pkg --> y');
    expect(neutralizeMarkers('<!-- releasekit-manifest -->')).toBe('&lt;!-- releasekit-manifest -->');
    expect(neutralizeMarkers('<!-- rk-sel:pkg -->')).toBe('&lt;!-- rk-sel:pkg -->');
    // Also the no-space form, which the marker slicing would still see as `<!--` + prefix.
    expect(neutralizeMarkers('<!--releasekit-notes -->')).toBe('&lt;!--releasekit-notes -->');
  });

  it('should leave unrelated HTML comments and prose untouched', () => {
    expect(neutralizeMarkers('<!-- TODO: fix this -->')).toBe('<!-- TODO: fix this -->');
    expect(neutralizeMarkers('a normal <!-- note --> comment')).toBe('a normal <!-- note --> comment');
    expect(neutralizeMarkers('no comments at all')).toBe('no comments at all');
  });

  it('should scan a long adversarial input linearly (no polynomial-regex ReDoS)', () => {
    const long = '<!-- '.repeat(100_000);
    // Returns promptly and unchanged: none of these openers is followed by a releasekit/rk prefix.
    expect(neutralizeMarkers(long)).toBe(long);
  });
});
