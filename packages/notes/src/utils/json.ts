/**
 * Extracts a JSON object or array from a raw LLM response.
 *
 * Handles two common issues with LLM output:
 * 1. The response is wrapped in markdown code fences (```json ... ```)
 * 2. The model adds preamble or postamble text around the JSON
 */
export function extractJsonFromResponse(response: string): string {
  // Strip outermost markdown code fences
  const stripped = response
    .replace(/^```(?:json)?\n?/, '')
    .replace(/\n?```$/, '')
    .trim();

  // Try to extract a JSON object (from first { to last }) or array (from first [ to last ]).
  // The greedy [\s\S]* match combined with backtracking finds the largest balanced span,
  // which in practice means: first delimiter to last matching delimiter, ignoring any
  // preamble or postamble text the model may have added.
  const objectMatch = stripped.match(/\{[\s\S]*\}/);
  if (objectMatch) return objectMatch[0];

  const arrayMatch = stripped.match(/\[[\s\S]*\]/);
  if (arrayMatch) return arrayMatch[0];

  // No JSON delimiters found — return stripped response so JSON.parse produces a clear error
  return stripped;
}
