import type { Example, ExampleEntry } from './types.js';

const LEAD_IN_RE = /^\*\*([^*]+)\*\*:\s*/;
const BULLET_RE = /^[-*]\s+/;

export function parseReleaseBodyToExample(markdown: string, version: string): Example | null {
  const lines = markdown.split('\n');
  const entries: ExampleEntry[] = [];
  let currentCategory = 'General';

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    // ### Heading → new category
    if (line.startsWith('### ')) {
      currentCategory = line.slice(4).trim();
      continue;
    }
    // ## Heading → skip (usually the version title)
    if (line.startsWith('#')) continue;

    // Bullet entry
    if (BULLET_RE.test(line)) {
      const text = line.replace(BULLET_RE, '');
      const leadInMatch = LEAD_IN_RE.exec(text);
      const entry: ExampleEntry = {
        description: leadInMatch ? text.slice(leadInMatch[0].length) : text,
        category: currentCategory,
      };
      if (leadInMatch) entry.leadIn = leadInMatch[1];
      if (/\*\*BREAKING\*\*/i.test(text)) entry.breaking = true;
      entries.push(entry);
    }
  }

  if (entries.length === 0) return null;
  return { version, entries };
}

export function renderExamplesBlock(examples: Example[]): string {
  if (examples.length === 0) return '';

  const blocks = examples.map((ex) => {
    const entryLines = ex.entries
      .map((e) => {
        const leadIn = e.leadIn ? `**${e.leadIn}**: ` : '';
        const scope = e.scope ? ` (${e.scope})` : '';
        const breaking = e.breaking ? ' **BREAKING**' : '';
        return `  - [${e.category}]${scope}: ${leadIn}${e.description}${breaking}`;
      })
      .join('\n');
    return `<example version="${ex.version}">\n${entryLines}\n</example>`;
  });

  return `\nExamples from prior releases (use these as style references):\n${blocks.join('\n')}\n`;
}
