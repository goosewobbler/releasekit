import { warn } from '@releasekit/core';
import type { ChangelogEntry } from '../../core/types.js';
import { LLM_DEFAULTS } from '../defaults.js';
import type { EnhanceContext, LLMProvider } from '../index.js';
import type { LLMMessage } from '../messages.js';
import { resolveSystemPrompt } from '../prompts.js';
import { INSTRUCTION_HIERARCHY, renderEntry } from './shared.js';

function buildSystemPrompt(style: string | undefined): string {
  const styleText = style ? `- ${style}` : '- Use past tense ("Added feature" not "Add feature")';
  return `You are improving changelog entries for a software project.
Given a technical commit message, rewrite it as a clear, user-friendly changelog entry.

${INSTRUCTION_HIERARCHY}

Rules:
- Be concise (1-2 sentences max)
- Focus on user impact, not implementation details
- Don't use technical jargon unless necessary
- Preserve the scope if mentioned (e.g., "core:", "api:")
${styleText}

Output only the rewritten description, nothing else.`;
}

function buildUserPrompt(entry: ChangelogEntry): string {
  return renderEntry(entry, 0);
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
  let failures = 0;

  for (let i = 0; i < entries.length; i += concurrency) {
    const batch = entries.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(async (entry) => {
        try {
          const newDescription = await enhanceEntry(provider, entry, context);
          return { ...entry, description: newDescription };
        } catch {
          // Per-entry soft-fail: keep the raw entry so one failure doesn't sink the batch.
          failures++;
          return entry;
        }
      }),
    );
    results.push(...batchResults);
  }

  if (failures > 0) {
    // Surface the count so a run that silently mixes enhanced and raw voice is visible.
    warn(`LLM enhancement failed for ${failures} of ${entries.length} entries; keeping their original text.`);
  }

  return results;
}
