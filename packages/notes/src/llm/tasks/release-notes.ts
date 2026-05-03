import type { ChangelogEntry } from '../../core/types.js';
import { renderExamplesBlock } from '../examples/parser.js';
import type { LLMProvider, ReleaseNotesContext } from '../index.js';
import type { LLMMessage } from '../messages.js';
import { resolveSystemPrompt } from '../prompts.js';

const DEFAULT_SYSTEM_PROMPT = `You are writing release notes for a software project.

Rules:
- Start with a brief introduction (1-2 sentences)
- Group related changes into sections
- Use friendly, approachable language
- Highlight breaking changes prominently
- End with a brief conclusion or call to action
- Use markdown formatting

Output only the markdown content.`;

function escAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function buildUserPrompt(entries: ChangelogEntry[], context: ReleaseNotesContext): string {
  const version = context.version ?? 'v1.0.0';
  const date = context.date ?? new Date().toISOString().split('T')[0] ?? '';
  const prevLine = context.previousVersion ? `Previous version: ${context.previousVersion}\n` : '';

  const entriesText = entries
    .map((e) => {
      let line = `- [${e.type}]`;
      if (e.scope) line += ` (${e.scope})`;
      line += `: ${e.description}`;
      if (e.breaking) line += ' **BREAKING**';
      if (e.context?.prs.length) {
        const prBlocks = e.context.prs
          .map((pr) => `<pr number="${pr.number}" title="${escAttr(pr.title)}">${pr.body ? `\n${pr.body}\n` : ''}</pr>`)
          .join('\n');
        line += `\n${prBlocks}`;
      }
      return line;
    })
    .join('\n');

  return `Version: ${version}\n${prevLine}Date: ${date}\n\nChanges:\n${entriesText}`;
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
