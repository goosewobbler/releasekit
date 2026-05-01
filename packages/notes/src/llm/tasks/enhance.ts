import type { ChangelogEntry } from '../../core/types.js';
import { LLM_DEFAULTS } from '../defaults.js';
import type { EnhanceContext, LLMProvider } from '../index.js';
import type { LLMMessage } from '../messages.js';
import { resolveSystemPrompt } from '../prompts.js';

function buildSystemPrompt(style: string | undefined): string {
  const styleText = style ? `- ${style}` : '- Use present tense ("Add feature" not "Added feature")';
  return `You are improving changelog entries for a software project.
Given a technical commit message, rewrite it as a clear, user-friendly changelog entry.

Rules:
- Be concise (1-2 sentences max)
- Focus on user impact, not implementation details
- Don't use technical jargon unless necessary
- Preserve the scope if mentioned (e.g., "core:", "api:")
${styleText}

Output only the rewritten description, nothing else.`;
}

function buildUserPrompt(entry: ChangelogEntry): string {
  const lines = [`Type: ${entry.type}`];
  if (entry.scope) lines.push(`Scope: ${entry.scope}`);
  lines.push(`Description: ${entry.description}`);
  return lines.join('\n');
}

export async function enhanceEntry(
  provider: LLMProvider,
  entry: ChangelogEntry,
  context: EnhanceContext,
): Promise<string> {
  const systemPrompt = resolveSystemPrompt('enhance', buildSystemPrompt(context.style), context.prompts);

  const messages: LLMMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: buildUserPrompt(entry) },
  ];

  const result = await provider.complete(messages);
  return result.content.trim();
}

export async function enhanceEntries(
  provider: LLMProvider,
  entries: ChangelogEntry[],
  context: EnhanceContext,
  concurrency: number = LLM_DEFAULTS.concurrency,
): Promise<ChangelogEntry[]> {
  const results: ChangelogEntry[] = [];

  for (let i = 0; i < entries.length; i += concurrency) {
    const batch = entries.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(async (entry) => {
        try {
          const newDescription = await enhanceEntry(provider, entry, context);
          return { ...entry, description: newDescription };
        } catch {
          return entry;
        }
      }),
    );
    results.push(...batchResults);
  }

  return results;
}
