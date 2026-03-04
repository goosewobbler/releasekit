import { warn } from '@releasekit/core';
import type { ChangelogEntry } from '../../core/types.js';
import type { CategorizeContext, CategorizedEntries, LLMProvider } from '../index.js';

const DEFAULT_CATEGORIZE_PROMPT = `You are categorizing changelog entries for a software release.

Given the following entries, group them into meaningful categories (e.g., "Core", "UI", "API", "Performance", "Bug Fixes", "Documentation").

Output a JSON object where keys are category names and values are arrays of entry indices (0-based).

Entries:
{{entries}}

Output only valid JSON, nothing else:`;

function buildCustomCategorizePrompt(categories: Array<{ name: string; description: string }>): string {
  const categoryList = categories.map((c) => `- "${c.name}": ${c.description}`).join('\n');

  return `You are categorizing changelog entries for a software release.

Given the following entries, group them into the specified categories. Only use the categories listed below.

Categories:
${categoryList}

For entries in categories that involve internal/developer changes, set a "scope" field on those entries with a short subcategory label (e.g., "CI", "Dependencies", "Testing", "Code Quality", "Build System").

Output a JSON object with two fields:
- "categories": an object where keys are category names and values are arrays of entry indices (0-based)
- "scopes": an object where keys are entry indices (as strings) and values are scope labels

Entries:
{{entries}}

Output only valid JSON, nothing else:`;
}

export async function categorizeEntries(
  provider: LLMProvider,
  entries: ChangelogEntry[],
  context: CategorizeContext,
): Promise<CategorizedEntries[]> {
  if (entries.length === 0) {
    return [];
  }

  const entriesText = entries
    .map((e, i) => `${i}. [${e.type}]${e.scope ? ` (${e.scope})` : ''}: ${e.description}`)
    .join('\n');

  const hasCustomCategories = context.categories && context.categories.length > 0;
  const promptTemplate = hasCustomCategories
    ? buildCustomCategorizePrompt(context.categories!)
    : DEFAULT_CATEGORIZE_PROMPT;

  const prompt = promptTemplate.replace('{{entries}}', entriesText);

  try {
    const response = await provider.complete(prompt);

    const cleaned = response
      .replace(/^```(?:json)?\n?/, '')
      .replace(/\n?```$/, '')
      .trim();
    const parsed = JSON.parse(cleaned);

    const result: CategorizedEntries[] = [];

    if (hasCustomCategories && parsed.categories) {
      // Custom categories format: { categories: { ... }, scopes: { ... } }
      const categoryMap = parsed.categories as Record<string, number[]>;
      const scopeMap = (parsed.scopes || {}) as Record<string, string>;

      // Apply scopes to entries
      for (const [indexStr, scope] of Object.entries(scopeMap)) {
        const idx = Number.parseInt(indexStr, 10);
        if (entries[idx] && scope) {
          entries[idx] = { ...entries[idx], scope: scope as string };
        }
      }

      for (const [category, indices] of Object.entries(categoryMap)) {
        const categoryEntries = indices.map((i) => entries[i]).filter((e): e is ChangelogEntry => e !== undefined);

        if (categoryEntries.length > 0) {
          result.push({ category, entries: categoryEntries });
        }
      }
    } else {
      // Default format: { "Category": [0, 1, 2] }
      const categoryMap = parsed as Record<string, number[]>;

      for (const [category, indices] of Object.entries(categoryMap)) {
        const categoryEntries = indices.map((i) => entries[i]).filter((e): e is ChangelogEntry => e !== undefined);

        if (categoryEntries.length > 0) {
          result.push({ category, entries: categoryEntries });
        }
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
