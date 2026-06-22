import { describe, expect, it } from 'vitest';
import {
  extractSelectionRegion,
  rkSelMarker,
  SELECTION_MARKER,
  SELECTION_MARKER_END,
  wrapSelectionRegion,
} from '../../src/selectionRegion.js';

describe('selectionRegion', () => {
  describe('rkSelMarker', () => {
    it('should carry the package name in a per-row identity marker', () => {
      expect(rkSelMarker('@scope/pkg')).toBe('<!-- rk-sel:@scope/pkg -->');
    });
  });

  describe('wrapSelectionRegion', () => {
    it('should wrap content in the opener and closer markers', () => {
      const wrapped = wrapSelectionRegion('- [x] `a`');
      expect(wrapped).toBe(`${SELECTION_MARKER}\n\n- [x] \`a\`\n\n${SELECTION_MARKER_END}`);
    });
  });

  describe('extractSelectionRegion', () => {
    it('should round-trip wrapped content', () => {
      expect(extractSelectionRegion(wrapSelectionRegion('rows here'))).toBe('rows here');
    });

    it('should extract only the region, ignoring surrounding prose', () => {
      const body = `## Release\n\n${wrapSelectionRegion('the rows')}\n\nchangelog...`;
      expect(extractSelectionRegion(body)).toBe('the rows');
    });

    it('should return undefined when the opener is absent', () => {
      expect(extractSelectionRegion('no selection here')).toBeUndefined();
    });

    it('should not match the closer as if it were the opener', () => {
      expect(extractSelectionRegion(SELECTION_MARKER_END)).toBeUndefined();
    });
  });
});
