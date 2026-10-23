export function extractJsonFromResponse(response: string): string {
  const stripped = response
    .replace(/^```(?:json)?\n?/, '')
    .replace(/\n?```$/, '')
    .trim();

  // First delimiter to last, dropping any preamble or postamble text the model may have added.
  const objectMatch = stripped.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    return objectMatch[0];
  }

  const arrayMatch = stripped.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    return arrayMatch[0];
  }

  // Return the stripped response so JSON.parse produces a clear error
  return stripped;
}
