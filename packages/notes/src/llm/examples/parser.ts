import { escAttr, escBody } from '../tasks/shared.js';
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

    // ## / ### / #### Heading → new category (h1 skipped as document title)
    const headingMatch = /^#{2,4} (.+)/.exec(line);
    if (headingMatch) {
      currentCategory = headingMatch[1]!.trim();
      continue;
    }
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

  // These examples are built from past release bodies and re-fed as few-shot input, and release-notes
  // output becomes a future example — a self-poisoning loop. Escape every interpolated field so an
  // entry can't forge a `</example>` tag or inject instructions into a later prompt.
  const blocks = examples.map((ex) => {
    const entryLines = ex.entries
      .map((e) => {
        const leadIn = e.leadIn ? `**${escBody(e.leadIn)}**: ` : '';
        const scope = e.scope ? ` (${escBody(e.scope)})` : '';
        const breaking = e.breaking ? ' **BREAKING**' : '';
        return `  - [${escBody(e.category)}]${scope}: ${leadIn}${escBody(e.description)}${breaking}`;
      })
      .join('\n');
    return `<example version="${escAttr(ex.version)}">\n${entryLines}\n</example>`;
  });

  return `\nExamples from prior releases (use these as style references):\n${blocks.join('\n')}\n`;
}
