import type { ChangelogEntry } from '../../core/types.js';
import { LLM_DEFAULTS } from '../defaults.js';
import type { EnhanceContext, LLMProvider } from '../index.js';
import { resolvePrompt } from '../prompts.js';

const DEFAULT_ENHANCE_PROMPT = `You are improving changelog entries for a software project.
Given a technical commit message, rewrite it as a clear, user-friendly changelog entry.

Rules:
- Be concise (1-2 sentences max)
- Focus on user impact, not implementation details
- Don't use technical jargon unless necessary
- Preserve the scope if mentioned (e.g., "core:", "api:")
{{style}}

Original entry:
Type: {{type}}
{{#if scope}}Scope: {{scope}}{{/if}}
Description: {{description}}

Rewritten description (only output the new description, nothing else):`;

export async function enhanceEntry(
  provider: LLMProvider,
  entry: ChangelogEntry,
  context: EnhanceContext,
): Promise<string> {
  const styleText = context.style ? `- ${context.style}` : '- Use present tense ("Add feature" not "Added feature")';
  const defaultPrompt = DEFAULT_ENHANCE_PROMPT.replace('{{style}}', styleText)
    .replace('{{type}}', entry.type)
    .replace('{{#if scope}}Scope: {{scope}}{{/if}}', entry.scope ? `Scope: ${entry.scope}` : '')
    .replace('{{description}}', entry.description);

  const prompt = resolvePrompt('enhance', defaultPrompt, context.prompts);
  const response = await provider.complete(prompt);

  return response.trim();
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
