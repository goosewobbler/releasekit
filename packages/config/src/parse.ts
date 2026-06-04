import { type ParseError, parse, printParseErrorCode } from 'jsonc-parser';

/**
 * Parses JSONC (JSON with comments) content.
 *
 * Strict JSON parses identically to `JSON.parse`. JSONC features (line and
 * block comments, trailing commas) are supported via a string-aware parser, so
 * `//` and `/* *\/` sequences inside string values are never mistaken for
 * comments. Malformed input throws a `SyntaxError` with a useful message.
 */
export function parseJsonc(content: string): unknown {
  // Fast path: valid strict JSON parses identically to JSON.parse.
  try {
    return JSON.parse(content);
  } catch {
    // Fall through to the JSONC parser for comments/trailing commas.
  }

  const errors: ParseError[] = [];
  const result = parse(content, errors, { allowTrailingComma: true });

  if (errors.length > 0) {
    const { error, offset } = errors[0];
    throw new SyntaxError(`Invalid JSONC: ${printParseErrorCode(error)} at position ${offset}`);
  }

  // The parser returns `undefined` (with no errors) when the input holds no
  // value at all — e.g. only comments or whitespace. Treat that as invalid.
  if (result === undefined) {
    throw new SyntaxError('Invalid JSONC: no value found');
  }

  return result;
}
