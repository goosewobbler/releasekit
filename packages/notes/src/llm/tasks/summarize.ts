import type { ChangelogEntry } from '../../core/types.js';
import type { LLMProvider, SummarizeContext } from '../index.js';

const SUMMARIZE_PROMPT = `You are creating a summary of changes for a software release.

Given the following changelog entries, create a brief summary (2-3 sentences) that captures the main themes of this release.

Entries:
{{entries}}

Summary (only output the summary, nothing else):`;

export async function summarizeEntries(
  provider: LLMProvider,
  entries: ChangelogEntry[],
  _context: SummarizeContext,
): Promise<string> {
  if (entries.length === 0) {
    return '';
  }

  const entriesText = entries.map((e) => `- [${e.type}]${e.scope ? ` (${e.scope})` : ''}: ${e.description}`).join('\n');

  const prompt = SUMMARIZE_PROMPT.replace('{{entries}}', entriesText);

  const response = await provider.complete(prompt);

  return response.trim();
}
