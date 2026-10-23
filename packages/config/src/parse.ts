import { type ParseError, parse, printParseErrorCode } from 'jsonc-parser';

/**
 * Uses a string-aware parser so `//` and `/* *\/` sequences inside string
 * values are never mistaken for comments.
 */
export function parseJsonc(content: string): unknown {
  // Fast path for strict JSON.
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

  // The parser returns `undefined` without errors for comment- or
  // whitespace-only input.
  if (result === undefined) {
    throw new SyntaxError('Invalid JSONC: no value found');
  }

  return result;
}
