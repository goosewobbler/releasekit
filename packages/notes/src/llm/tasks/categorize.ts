import { warn } from '@releasekit/core';
import type { ChangelogEntry, LLMCategory } from '../../core/types.js';
import { extractJsonFromResponse } from '../../utils/json.js';
import type { CategorizeContext, CategorizedEntries, LLMProvider } from '../index.js';
import { resolvePrompt } from '../prompts.js';
import { getAllowedScopesFromCategories, validateEntryScopes } from '../scopes.js';

const DEFAULT_CATEGORIZE_PROMPT = `You are categorizing changelog entries for a software release.

Given the following entries, group them into meaningful categories (e.g., "Core", "UI", "API", "Performance", "Bug Fixes", "Documentation").

Output a JSON object where keys are category names and values are arrays of entry indices (0-based).

Entries:
{{entries}}

Output only valid JSON, nothing else:`;

function buildCustomCategorizePrompt(categories: LLMCategory[]): string {
  const categoryList = categories
    .map((c) => {
      const scopeInfo = c.scopes?.length ? ` Allowed scopes: ${c.scopes.join(', ')}.` : '';
      return `- "${c.name}": ${c.description}${scopeInfo}`;
    })
    .join('\n');

  const scopeMap = getAllowedScopesFromCategories(categories);
  let scopeInstructions = '';
  if (scopeMap.size > 0) {
    const entries: string[] = [];
    for (const [catName, scopes] of scopeMap) {
      entries.push(`For "${catName}", assign a scope from: ${scopes.join(', ')}.`);
    }
    scopeInstructions = `\n\n${entries.join('\n')}\nOnly use scopes from these predefined lists. If an entry does not fit any scope, set scope to null.`;
  }

  return `You are categorizing changelog entries for a software release.

Given the following entries, group them into the specified categories. Only use the categories listed below in this exact order:

Categories:
${categoryList}${scopeInstructions}

Output a JSON object with two fields:
- "categories": an object where keys are category names and values are arrays of entry indices (0-based)
- "scopes": an object where keys are entry indices (as strings) and values are scope labels. Only include entries that have a valid scope from the predefined list.

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

  // Create a copy of entries with scopes cleared for LLM processing
  const entriesCopy: ChangelogEntry[] = entries.map((e) => ({ ...e, scope: undefined }));

  const entriesText = entriesCopy.map((e, i) => `${i}. [${e.type}]: ${e.description}`).join('\n');

  const hasCustomCategories = context.categories && context.categories.length > 0;
  const defaultPrompt = hasCustomCategories
    ? buildCustomCategorizePrompt(context.categories as LLMCategory[])
    : DEFAULT_CATEGORIZE_PROMPT;

  const promptTemplate = resolvePrompt('categorize', defaultPrompt, context.prompts);
  const prompt = promptTemplate.replace('{{entries}}', entriesText);

  try {
    const response = await provider.complete(prompt);

    const parsed = JSON.parse(extractJsonFromResponse(response));

    const result: CategorizedEntries[] = [];

    if (hasCustomCategories && parsed.categories) {
      // Custom categories format: { categories: { ... }, scopes: { ... } }
      const categoryMap = parsed.categories as Record<string, unknown>;
      const scopeMap = (parsed.scopes || {}) as Record<string, string>;

      // Apply scopes to entries (only if LLM provided a valid scope)
      for (const [indexStr, scope] of Object.entries(scopeMap)) {
        const idx = Number.parseInt(indexStr, 10);
        if (entriesCopy[idx] && scope && scope.trim()) {
          entriesCopy[idx] = { ...entriesCopy[idx], scope: scope.trim() };
        }
      }

      // Post-process: validate scopes against config
      const validatedEntries = validateEntryScopes(entriesCopy, context.scopes, context.categories);

      for (const [category, rawIndices] of Object.entries(categoryMap)) {
        const indices = Array.isArray(rawIndices) ? rawIndices : [];
        const categoryEntries = indices
          .map((i) => validatedEntries[i])
          .filter((e): e is ChangelogEntry => e !== undefined);

        if (categoryEntries.length > 0) {
          result.push({ category, entries: categoryEntries });
        }
      }
    } else {
      // Default format: { "Category": [0, 1, 2] }
      const categoryMap = parsed as Record<string, unknown>;

      for (const [category, rawIndices] of Object.entries(categoryMap)) {
        const indices = Array.isArray(rawIndices) ? rawIndices : [];
        const categoryEntries = indices.map((i) => entriesCopy[i]).filter((e): e is ChangelogEntry => e !== undefined);

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
    return [{ category: 'General', entries: entriesCopy }];
  }
}
