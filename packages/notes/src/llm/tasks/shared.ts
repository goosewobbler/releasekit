import type { ChangelogEntry } from '../../core/types.js';
import type { CategorizedEntries } from '../index.js';

export function escAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

export function escBody(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function renderPRBlocks(entry: ChangelogEntry): string {
  if (!entry.context?.prs.length) return '';
  return entry.context.prs
    .map(
      (pr) => `<pr number="${pr.number}" title="${escAttr(pr.title)}">${pr.body ? `\n${escBody(pr.body)}\n` : ''}</pr>`,
    )
    .join('\n');
}

/**
 * Groups entries by category using the parallel LLM response array.
 * Callers must validate that llmEntries.length === entries.length before calling.
 */
export function groupByCategory(
  llmEntries: Array<{ category: string }>,
  entries: ChangelogEntry[],
): CategorizedEntries[] {
  const categoryMap = new Map<string, ChangelogEntry[]>();
  for (let i = 0; i < llmEntries.length; i++) {
    const category = llmEntries[i]?.category ?? 'Unknown';
    const entry = entries[i];
    if (!entry) continue;
    if (!categoryMap.has(category)) categoryMap.set(category, []);
    categoryMap.get(category)!.push(entry);
  }
  const result: CategorizedEntries[] = [];
  for (const [category, catEntries] of categoryMap) {
    result.push({ category, entries: catEntries });
  }
  return result;
}
