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

  // Extract Developer category scopes if specified in description
  const developerCategory = categories.find((c) => c.name === 'Developer');
  let scopeInstructions = '';

  if (developerCategory) {
    // Look for predefined scopes in description (format: "MUST assign a scope from: A, B, C")
    const scopeMatch = developerCategory.description.match(/from:\s*([^.]+)/);
    if (scopeMatch?.[1]) {
      const scopes = scopeMatch[1]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (scopes.length > 0) {
        scopeInstructions = `\n\nFor the "Developer" category, you MUST assign a scope from this exact list: ${scopes.join(', ')}.\n`;
      }
    }
  }

  const scopeValidationInstructions = scopeInstructions
    ? `\n\nIMPORTANT: When assigning scopes, you MUST ONLY use scopes from the predefined list above. DO NOT use scopes from conventional commit messages (like "version", "core", "api", etc.). If an entry does not fit any of the predefined scopes, leave the scope as null.`
    : '';

  return `You are categorizing changelog entries for a software release.

Given the following entries, group them into the specified categories. Only use the categories listed below in this exact order:

Categories:
${categoryList}${scopeInstructions}${scopeValidationInstructions}
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
  // The LLM will assign new scopes only from the predefined valid list
  const entriesCopy: ChangelogEntry[] = entries.map((e) => ({ ...e, scope: undefined }));

  const entriesText = entriesCopy.map((e, i) => `${i}. [${e.type}]: ${e.description}`).join('\n');

  const hasCustomCategories = context.categories && context.categories.length > 0;
  const promptTemplate = hasCustomCategories
    ? buildCustomCategorizePrompt(context.categories as Array<{ name: string; description: string }>)
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
      const categoryMap = parsed.categories as Record<string, unknown>;
      const scopeMap = (parsed.scopes || {}) as Record<string, string>;

      // Apply scopes to entries (only if LLM provided a valid scope)
      for (const [indexStr, scope] of Object.entries(scopeMap)) {
        const idx = Number.parseInt(indexStr, 10);
        if (entriesCopy[idx] && scope && scope.trim()) {
          entriesCopy[idx] = { ...entriesCopy[idx], scope: scope.trim() };
        }
      }

      for (const [category, rawIndices] of Object.entries(categoryMap)) {
        const indices = Array.isArray(rawIndices) ? rawIndices : [];
        const categoryEntries = indices.map((i) => entriesCopy[i]).filter((e): e is ChangelogEntry => e !== undefined);

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
    // Return entries (with scopes cleared) on error
    return [{ category: 'General', entries: entriesCopy }];
  }
}
