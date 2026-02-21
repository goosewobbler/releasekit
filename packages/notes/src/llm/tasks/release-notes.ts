import type { ChangelogEntry } from '../../core/types.js';
import type { LLMProvider, ReleaseNotesContext } from '../index.js';

const RELEASE_NOTES_PROMPT = `You are writing release notes for a software project.

Create engaging, user-friendly release notes for the following changes.

Rules:
- Start with a brief introduction (1-2 sentences)
- Group related changes into sections
- Use friendly, approachable language
- Highlight breaking changes prominently
- End with a brief conclusion or call to action
- Use markdown formatting

Version: {{version}}
{{#if previousVersion}}Previous version: {{previousVersion}}{{/if}}
Date: {{date}}

Changes:
{{entries}}

Release notes (output only the markdown content):`;

export async function generateReleaseNotes(
  provider: LLMProvider,
  entries: ChangelogEntry[],
  context: ReleaseNotesContext,
): Promise<string> {
  if (entries.length === 0) {
    return `## Release ${context.version ?? 'v1.0.0'}\n\nNo notable changes in this release.`;
  }

  const entriesText = entries
    .map((e) => {
      let line = `- [${e.type}]`;
      if (e.scope) line += ` (${e.scope})`;
      line += `: ${e.description}`;
      if (e.breaking) line += ' **BREAKING**';
      return line;
    })
    .join('\n');

  const prompt = RELEASE_NOTES_PROMPT.replace('{{version}}', context.version ?? 'v1.0.0')
    .replace(
      '{{#if previousVersion}}Previous version: {{previousVersion}}{{/if}}',
      context.previousVersion ? `Previous version: ${context.previousVersion}` : '',
    )
    .replace('{{date}}', context.date ?? new Date().toISOString().split('T')[0] ?? '')
    .replace('{{entries}}', entriesText);

  const response = await provider.complete(prompt);

  return response.trim();
}
