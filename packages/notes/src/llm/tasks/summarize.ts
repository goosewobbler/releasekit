import type { ChangelogEntry } from '../../core/types.js';
import type { LLMProvider, SummarizeContext } from '../index.js';
import type { LLMMessage } from '../messages.js';
import { resolveSystemPrompt } from '../prompts.js';

const DEFAULT_SYSTEM_PROMPT = `You are creating a summary of changes for a software release.
Create a brief summary (2-3 sentences) that captures the main themes of this release.
Output only the summary text, nothing else.`;

function buildUserPrompt(entries: ChangelogEntry[]): string {
  const text = entries.map((e) => `- [${e.type}]${e.scope ? ` (${e.scope})` : ''}: ${e.description}`).join('\n');
  return `Entries:\n${text}`;
}

export async function summarizeEntries(
  provider: LLMProvider,
  entries: ChangelogEntry[],
  context: SummarizeContext,
): Promise<string> {
  if (entries.length === 0) {
    return '';
  }

  const systemPrompt = resolveSystemPrompt('summarize', DEFAULT_SYSTEM_PROMPT, context.prompts);

  const messages: LLMMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: buildUserPrompt(entries) },
  ];

  const result = await provider.complete(messages);
  return result.content.trim();
}
