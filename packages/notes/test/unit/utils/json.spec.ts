import { describe, expect, it } from 'vitest';
import { extractJsonFromResponse } from '../../../src/utils/json.js';

describe('extractJsonFromResponse()', () => {
  it('returns clean JSON object as-is', () => {
    const input = '{"key": "value"}';
    expect(extractJsonFromResponse(input)).toBe(input);
  });

  it('returns clean JSON array as-is', () => {
    const input = '[1, 2, 3]';
    expect(extractJsonFromResponse(input)).toBe(input);
  });

  it('strips ```json code fence', () => {
    const result = extractJsonFromResponse('```json\n{"a": 1}\n```');
    expect(result).toBe('{"a": 1}');
  });

  it('strips plain ``` code fence', () => {
    const result = extractJsonFromResponse('```\n{"a": 1}\n```');
    expect(result).toBe('{"a": 1}');
  });

  it('extracts JSON object from preamble text', () => {
    const result = extractJsonFromResponse('Here is the output:\n{"key": "value"}');
    expect(result).toBe('{"key": "value"}');
  });

  it('extracts JSON object when model adds postamble text', () => {
    const result = extractJsonFromResponse('{"key": "value"}\n\nLet me know if you need anything else.');
    expect(result).toBe('{"key": "value"}');
  });

  it('extracts JSON array from surrounding text', () => {
    const result = extractJsonFromResponse('The result is: [1, 2, 3] — done.');
    expect(result).toBe('[1, 2, 3]');
  });

  it('prefers object over array when both present', () => {
    const result = extractJsonFromResponse('some text {"key": [1, 2]} end');
    expect(result).toBe('{"key": [1, 2]}');
  });

  it('returns stripped response when no JSON delimiters found', () => {
    const result = extractJsonFromResponse('  no json here  ');
    expect(result).toBe('no json here');
  });
});
