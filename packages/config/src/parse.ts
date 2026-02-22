export function parseJsonc(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    const cleaned = content
      .replace(/\/\/.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .trim();
    return JSON.parse(cleaned);
  }
}
