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

  // Regression: a real comment forces the JSONC path, and the `//`
  // inside the $schema URL must not be treated as a line comment.
  it('should parse a config with a comment and an https URL ($schema)', () => {
    const jsonc = `{
      // standing-pr config
      "$schema": "https://goosewobbler.github.io/releasekit/schema.json",
      "git": { "pushMethod": "ssh" }
    }`;
    const result = parseJsonc(jsonc);
    expect(result).toEqual({
      $schema: 'https://goosewobbler.github.io/releasekit/schema.json',
      git: { pushMethod: 'ssh' },
    });
  });

  it('should not strip // sequences inside string values', () => {
    const jsonc = `{
      // a comment to force the JSONC path
      "a": "http://a",
      "b": "x // not a comment",
      "c": "/* also not a comment */"
    }`;
    const result = parseJsonc(jsonc);
    expect(result).toEqual({ a: 'http://a', b: 'x // not a comment', c: '/* also not a comment */' });
  });

  it('should parse comments-only structure (no URLs)', () => {
    const jsonc = `{
      // just a comment
      "key": "value"
    }`;
    expect(parseJsonc(jsonc)).toEqual({ key: 'value' });
  });

  it('should parse URLs without comments via the strict fast path', () => {
    const json = `{"$schema": "https://goosewobbler.github.io/releasekit/schema.json"}`;
    expect(parseJsonc(json)).toEqual({ $schema: 'https://goosewobbler.github.io/releasekit/schema.json' });
  });

  it('should parse block comments alongside URLs', () => {
    const jsonc = `{
      /* block comment */
      "url": "https://example.com//double-slash"
    }`;
    expect(parseJsonc(jsonc)).toEqual({ url: 'https://example.com//double-slash' });
  });

  it('should parse trailing commas', () => {
    const jsonc = `{
      // comment to force JSONC path
      "a": 1,
      "b": 2,
    }`;
    expect(parseJsonc(jsonc)).toEqual({ a: 1, b: 2 });
  });

  it('should throw on trailing content after a comment', () => {
    const jsonc = `{ "a": 1 } // trailing comment
    garbage`;
    expect(() => parseJsonc(jsonc)).toThrow();
  });

  it('should throw on comments-only input', () => {
    expect(() => parseJsonc('// only a comment')).toThrow();
  });

  it('should throw on a malformed value after a comment', () => {
    expect(() => parseJsonc('{ "a": } // comment')).toThrow();
  });
});
