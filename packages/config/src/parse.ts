const MAX_JSONC_LENGTH = 100000; // 100KB limit to prevent ReDoS

export function parseJsonc(content: string): unknown {
  // Limit input length to prevent ReDoS attacks
  if (content.length > MAX_JSONC_LENGTH) {
    throw new Error(`JSONC content too long: ${content.length} characters (max ${MAX_JSONC_LENGTH})`);
  }

  try {
    return JSON.parse(content);
  } catch {
    // Use safer regex patterns with length limits for comment removal
    const cleaned = content
      .replace(/\/\/[^\r\n]{0,10000}$/gm, '') // Line comments, max 10k chars per line
      .replace(/\/\*[\s\S]{0,50000}?\*\//g, '') // Block comments, max 50k chars
      .trim();
    return JSON.parse(cleaned);
  }
}
