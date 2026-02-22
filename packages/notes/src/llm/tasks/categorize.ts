import { warn } from '@releasekit/core';
import type { ChangelogEntry } from '../../core/types.js';
import type { CategorizeContext, CategorizedEntries, LLMProvider } from '../index.js';

const CATEGORIZE_PROMPT = `You are categorizing changelog entries for a software release.

Given the following entries, group them into meaningful categories (e.g., "Core", "UI", "API", "Performance", "Bug Fixes", "Documentation").

Output a JSON object where keys are category names and values are arrays of entry indices (0-based).

Entries:
{{entries}}

Output only valid JSON, nothing else:`;

export async function categorizeEntries(
  provider: LLMProvider,
  entries: ChangelogEntry[],
  _context: CategorizeContext,
): Promise<CategorizedEntries[]> {
  if (entries.length === 0) {
    return [];
  }

  const entriesText = entries
    .map((e, i) => `${i}. [${e.type}]${e.scope ? ` (${e.scope})` : ''}: ${e.description}`)
    .join('\n');

  const prompt = CATEGORIZE_PROMPT.replace('{{entries}}', entriesText);

  try {
    const response = await provider.complete(prompt);

    const cleaned = response
      .replace(/^```(?:json)?\n?/, '')
      .replace(/\n?```$/, '')
      .trim();
    const parsed = JSON.parse(cleaned) as Record<string, number[]>;

    const result: CategorizedEntries[] = [];

    for (const [category, indices] of Object.entries(parsed)) {
      const categoryEntries = indices.map((i) => entries[i]).filter((e): e is ChangelogEntry => e !== undefined);

      if (categoryEntries.length > 0) {
        result.push({
          category,
          entries: categoryEntries,
        });
      }
    }

    return result;
  } catch (error) {
    warn(
      `LLM categorization failed, falling back to General: ${error instanceof Error ? error.message : String(error)}`,
    );
    return [{ category: 'General', entries }];
  }
}
