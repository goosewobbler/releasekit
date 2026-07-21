import type { ChangelogEntry } from '../../core/types.js';
import { renderExamplesBlock } from '../examples/parser.js';
import type { LLMProvider, ReleaseNotesContext } from '../index.js';
import type { LLMMessage } from '../messages.js';
import { resolveSystemPrompt } from '../prompts.js';
import { INSTRUCTION_HIERARCHY, renderEntries } from './shared.js';

export const DEFAULT_SYSTEM_PROMPT = `You are writing release notes for a software project.

${INSTRUCTION_HIERARCHY}

Rules:
- Start with a brief introduction (1-2 sentences)
- Group related changes into sections
- Use friendly, approachable language
- Highlight breaking changes prominently
- End with a brief conclusion or call to action
- Use markdown formatting

Output only the markdown content.`;

function buildUserPrompt(entries: ChangelogEntry[], context: ReleaseNotesContext): string {
  const version = context.version ?? 'v1.0.0';
  const date = context.date ?? new Date().toISOString().split('T')[0] ?? '';
  const prevLine = context.previousVersion ? `Previous version: ${context.previousVersion}\n` : '';

  return `Version: ${version}\n${prevLine}Date: ${date}\n\nChanges:\n${renderEntries(entries)}`;
}

export async function generateReleaseNotes(
  provider: LLMProvider,
  entries: ChangelogEntry[],
  context: ReleaseNotesContext,
): Promise<string> {
  if (entries.length === 0) {
    return `## Release ${context.version ?? 'v1.0.0'}\n\nNo notable changes in this release.`;
  }

  const examplesBlock = renderExamplesBlock(context.examples ?? []);
  const systemPrompt = resolveSystemPrompt(
    'releaseNotes',
    examplesBlock ? `${DEFAULT_SYSTEM_PROMPT}${examplesBlock}` : DEFAULT_SYSTEM_PROMPT,
    context.prompts,
  );

  const messages: LLMMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: buildUserPrompt(entries, context) },
  ];

  const result = await provider.complete(messages);
  return result.content.trim();
}
