import { warn } from '@releasekit/core';
import type { ChangelogEntry, LLMCategory } from '../../core/types.js';
import { LLMError } from '../../errors/index.js';
import type { CategorizeContext, CategorizedEntries, LLMProvider } from '../index.js';
import type { LLMMessage } from '../messages.js';
import { resolveSystemPrompt } from '../prompts.js';
import { buildCategorizeSchema, CategorizeOutputSchema } from '../schemas.js';
import { getAllowedScopesFromCategories, validateEntryScopes } from '../scopes.js';
import {
  buildCategorySection,
  checkCategoryNames,
  groupByCategory,
  parseLLMResult,
  renderScopeInstruction,
  runCorrectiveTask,
  type TaskValidator,
} from './shared.js';

function buildSystemPrompt(categories: LLMCategory[] | undefined): string {
  const categorySection = buildCategorySection(
    categories,
    `Categories: Group into meaningful categories (e.g., "Core", "UI", "API", "Performance", "Bug Fixes", "Documentation").`,
  );

  // Scope source: explicit category `scopes` arrays via getAllowedScopesFromCategories.
  const pairs =
    categories && categories.length > 0
      ? [...getAllowedScopesFromCategories(categories)].map(([name, scopes]) => ({ name, scopes }))
      : [];
  const scopeInstruction = renderScopeInstruction(pairs, '');

  return `You are categorizing changelog entries for a software release.

${categorySection}${scopeInstruction}

Output a JSON object with an "entries" array. Each element (same order as input) must have:
- "category": category name from the list above
- "scope": subcategory label or null`;
}

function buildUserPrompt(entries: ChangelogEntry[]): string {
  const text = entries.map((e, i) => `${i}. [${e.type}]: ${e.description}`).join('\n');
  return `Entries:\n${text}`;
}

export function createCategorizeValidator(
  entries: ChangelogEntry[],
  context: CategorizeContext,
): TaskValidator<CategorizedEntries[]> {
  // Work with a copy that has scopes cleared (LLM assigns them fresh)
  const cleanEntries = entries.map((e) => ({ ...e, scope: undefined }));

  return (result) => {
    const parsed = parseLLMResult(result);
    if (!parsed.ok) return { valid: false, error: parsed.error };

    const zodResult = CategorizeOutputSchema.safeParse(parsed.data);
    if (!zodResult.success) {
      return { valid: false, error: `Schema error: ${zodResult.error.message}` };
    }

    if (zodResult.data.entries.length !== entries.length) {
      return {
        valid: false,
        error: `Expected ${entries.length} entries, got ${zodResult.data.entries.length}`,
      };
    }

    // Validate category names when categories are configured
    const categoryError = checkCategoryNames(
      zodResult.data.entries,
      context.categories?.map((c) => c.name),
    );
    if (categoryError) return { valid: false, error: categoryError };

    // Apply scopes from LLM response
    const withScopes: ChangelogEntry[] = cleanEntries.map((entry, i) => {
      const llmEntry = zodResult.data.entries[i];
      const scope = llmEntry?.scope ?? undefined;
      return scope ? { ...entry, scope } : entry;
    });

    // Validate scopes. The validator applies `invalidScopeAction` (default `remove`) and
    // returns `valid: true` — scope mismatches don't trigger an LLM retry, since the configured
    // action defines the resolution. Surface a warning so disallowed scopes stay visible.
    const scopeResult = validateEntryScopes(withScopes, context.scopes, context.categories);
    if (scopeResult.errors.length > 0) {
      const offenders = [...new Set(scopeResult.errors.map((e) => e.providedScope))];
      warn(
        `LLM returned ${scopeResult.errors.length} entries with disallowed scopes (${offenders.join(', ')}); resolved per invalidScopeAction.`,
      );
    }

    return { valid: true, value: groupByCategory(zodResult.data.entries, scopeResult.entries) };
  };
}

export async function categorizeEntries(
  provider: LLMProvider,
  entries: ChangelogEntry[],
  context: CategorizeContext,
): Promise<CategorizedEntries[]> {
  if (entries.length === 0) {
    return [];
  }

  const systemPrompt = resolveSystemPrompt('categorize', buildSystemPrompt(context.categories), context.prompts);

  const initialMessages: LLMMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: buildUserPrompt(entries) },
  ];

  try {
    return await runCorrectiveTask({
      provider,
      initialMessages,
      schema: buildCategorizeSchema(context.categories ?? []),
      toolName: 'categorize_entries',
      validate: createCategorizeValidator(entries, context),
    });
  } catch (error) {
    if (error instanceof LLMError) {
      warn(`categorizeEntries failed after all attempts: ${error.message}. Returning entries under General.`);
      // Triggered by structural validation failures the LLM couldn't recover from across the
      // retry budget: malformed JSON, schema-incompatible output, wrong entry count, or
      // categories outside the configured list. (Disallowed scopes don't reach here — the
      // configured invalidScopeAction resolves them in-place.) Strip scopes since the LLM
      // run never produced validated values.
      return [{ category: 'General', entries: entries.map((e) => ({ ...e, scope: undefined })) }];
    }
    throw error;
  }
}
