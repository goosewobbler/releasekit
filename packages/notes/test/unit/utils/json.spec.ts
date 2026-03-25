import { describe, expect, it } from 'vitest';
import { extractJsonFromResponse } from '../../../src/utils/json.js';

describe('extractJsonFromResponse()', () => {
  it('should return clean JSON object as-is', () => {
    const input = '{"key": "value"}';
    expect(extractJsonFromResponse(input)).toBe(input);
  });

  it('should return clean JSON array as-is', () => {
    const input = '[1, 2, 3]';
    expect(extractJsonFromResponse(input)).toBe(input);
  });

  it('should strip ```json code fence', () => {
    const result = extractJsonFromResponse('```json\n{"a": 1}\n```');
    expect(result).toBe('{"a": 1}');
  });

  it('should strip plain ``` code fence', () => {
    const result = extractJsonFromResponse('```\n{"a": 1}\n```');
    expect(result).toBe('{"a": 1}');
  });

  it('should extract JSON object from preamble text', () => {
    const result = extractJsonFromResponse('Here is the output:\n{"key": "value"}');
    expect(result).toBe('{"key": "value"}');
  });

  it('should extract JSON object when model adds postamble text', () => {
    const result = extractJsonFromResponse('{"key": "value"}\n\nLet me know if you need anything else.');
    expect(result).toBe('{"key": "value"}');
  });

  it('should extract JSON array from surrounding text', () => {
    const result = extractJsonFromResponse('The result is: [1, 2, 3] — done.');
    expect(result).toBe('[1, 2, 3]');
  });

  it('should prefer object over array when both present', () => {
    const result = extractJsonFromResponse('some text {"key": [1, 2]} end');
    expect(result).toBe('{"key": [1, 2]}');
  });

  it('should return stripped response when no JSON delimiters found', () => {
    const result = extractJsonFromResponse('  no json here  ');
    expect(result).toBe('no json here');
  });
});
