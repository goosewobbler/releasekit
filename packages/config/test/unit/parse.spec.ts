import { describe, expect, it } from 'vitest';
import { parseJsonc } from '../../src/parse.js';

describe('parseJsonc', () => {
  it('should parse valid JSON', () => {
    const result = parseJsonc('{"key": "value"}');
    expect(result).toEqual({ key: 'value' });
  });

  it('should parse JSON with single-line comments', () => {
    const jsonc = `{
      // This is a comment
      "key": "value"
    }`;
    const result = parseJsonc(jsonc);
    expect(result).toEqual({ key: 'value' });
  });

  it('should parse JSON with multi-line comments', () => {
    const jsonc = `{
      /* This is a
         multi-line comment */
      "key": "value"
    }`;
    const result = parseJsonc(jsonc);
    expect(result).toEqual({ key: 'value' });
  });

  it('should parse JSON with trailing comments', () => {
    const jsonc = `{"key": "value"} // trailing comment`;
    const result = parseJsonc(jsonc);
    expect(result).toEqual({ key: 'value' });
  });

  it('should parse JSON with inline comments', () => {
    const jsonc = `{"key": "value" /* inline */}`;
    const result = parseJsonc(jsonc);
    expect(result).toEqual({ key: 'value' });
  });

  it('should parse JSON with multiple comments', () => {
    const jsonc = `{
      // Comment 1
      "key1": "value1",
      /* Comment 2 */
      "key2": "value2" // Comment 3
    }`;
    const result = parseJsonc(jsonc);
    expect(result).toEqual({ key1: 'value1', key2: 'value2' });
  });

  it('should parse nested objects', () => {
    const jsonc = `{
      "outer": {
        // Inner comment
        "inner": "value"
      }
    }`;
    const result = parseJsonc(jsonc);
    expect(result).toEqual({ outer: { inner: 'value' } });
  });

  it('should parse arrays', () => {
    const jsonc = `{
      "items": [1, 2, 3]
    }`;
    const result = parseJsonc(jsonc);
    expect(result).toEqual({ items: [1, 2, 3] });
  });

  it('should parse numbers, booleans, and null', () => {
    const jsonc = `{
      "num": 42,
      "bool": true,
      "nil": null
    }`;
    const result = parseJsonc(jsonc);
    expect(result).toEqual({ num: 42, bool: true, nil: null });
  });

  it('should throw on invalid JSON', () => {
    expect(() => parseJsonc('{ invalid }')).toThrow();
  });

  it('should throw on unclosed braces', () => {
    expect(() => parseJsonc('{"key": "value"')).toThrow();
  });

  it('should handle empty object', () => {
    const result = parseJsonc('{}');
    expect(result).toEqual({});
  });

  it('should handle empty string after trimming', () => {
    const jsonc = `
      // Just a comment
    `;
    expect(() => parseJsonc(jsonc)).toThrow();
  });

  it('should preserve string content with comment-like characters', () => {
    const jsonc = `{
      "url": "https://example.com/path?q=1&a=2"
    }`;
    const result = parseJsonc(jsonc);
    expect(result).toEqual({ url: 'https://example.com/path?q=1&a=2' });
  });
});
