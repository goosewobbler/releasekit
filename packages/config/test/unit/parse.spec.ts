import { describe, expect, it } from 'vitest';
import { parseJsonc } from '../../src/parse.js';

describe('parseJsonc', () => {
  it('parses valid JSON', () => {
    const result = parseJsonc('{"key": "value"}');
    expect(result).toEqual({ key: 'value' });
  });

  it('parses JSON with single-line comments', () => {
    const jsonc = `{
      // This is a comment
      "key": "value"
    }`;
    const result = parseJsonc(jsonc);
    expect(result).toEqual({ key: 'value' });
  });

  it('parses JSON with multi-line comments', () => {
    const jsonc = `{
      /* This is a
         multi-line comment */
      "key": "value"
    }`;
    const result = parseJsonc(jsonc);
    expect(result).toEqual({ key: 'value' });
  });

  it('parses JSON with trailing comments', () => {
    const jsonc = `{"key": "value"} // trailing comment`;
    const result = parseJsonc(jsonc);
    expect(result).toEqual({ key: 'value' });
  });

  it('parses JSON with inline comments', () => {
    const jsonc = `{"key": "value" /* inline */}`;
    const result = parseJsonc(jsonc);
    expect(result).toEqual({ key: 'value' });
  });

  it('parses JSON with multiple comments', () => {
    const jsonc = `{
      // Comment 1
      "key1": "value1",
      /* Comment 2 */
      "key2": "value2" // Comment 3
    }`;
    const result = parseJsonc(jsonc);
    expect(result).toEqual({ key1: 'value1', key2: 'value2' });
  });

  it('parses nested objects', () => {
    const jsonc = `{
      "outer": {
        // Inner comment
        "inner": "value"
      }
    }`;
    const result = parseJsonc(jsonc);
    expect(result).toEqual({ outer: { inner: 'value' } });
  });

  it('parses arrays', () => {
    const jsonc = `{
      "items": [1, 2, 3]
    }`;
    const result = parseJsonc(jsonc);
    expect(result).toEqual({ items: [1, 2, 3] });
  });

  it('parses numbers, booleans, and null', () => {
    const jsonc = `{
      "num": 42,
      "bool": true,
      "nil": null
    }`;
    const result = parseJsonc(jsonc);
    expect(result).toEqual({ num: 42, bool: true, nil: null });
  });

  it('throws on invalid JSON', () => {
    expect(() => parseJsonc('{ invalid }')).toThrow();
  });

  it('throws on unclosed braces', () => {
    expect(() => parseJsonc('{"key": "value"')).toThrow();
  });

  it('handles empty object', () => {
    const result = parseJsonc('{}');
    expect(result).toEqual({});
  });

  it('handles empty string after trimming', () => {
    const jsonc = `
      // Just a comment
    `;
    expect(() => parseJsonc(jsonc)).toThrow();
  });

  it('preserves string content with comment-like characters', () => {
    const jsonc = `{
      "url": "https://example.com/path?q=1&a=2"
    }`;
    const result = parseJsonc(jsonc);
    expect(result).toEqual({ url: 'https://example.com/path?q=1&a=2' });
  });
});
