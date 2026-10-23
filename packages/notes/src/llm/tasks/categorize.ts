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
  INSTRUCTION_HIERARCHY,
  parseLLMResult,
  renderEntries,
  renderScopeInstruction,
  runCorrectiveTask,
  type TaskValidator,
} from './shared.js';

export function buildSystemPrompt(categories: LLMCategory[] | undefined): string {
  const categorySection = buildCategorySection(
    categories,
    `Categories: Group into meaningful categories (e.g., "Core", "UI", "API", "Performance", "Bug Fixes", "Documentation").`,
  );

  const pairs =
    categories && categories.length > 0
      ? [...getAllowedScopesFromCategories(categories)].map(([name, scopes]) => ({ name, scopes }))
      : [];
  const scopeInstruction = renderScopeInstruction(pairs, '');

  return `You are categorizing changelog entries for a software release.

${INSTRUCTION_HIERARCHY}

${categorySection}${scopeInstruction}

Output a JSON object with an "entries" array. Each element (same order as input) must have:
- "category": category name from the list above
- "scope": subcategory label or null`;
}

function buildUserPrompt(entries: ChangelogEntry[]): string {
  return `Entries:\n${renderEntries(entries)}`;
}

export function createCategorizeValidator(
  entries: ChangelogEntry[],
  context: CategorizeContext,
): TaskValidator<CategorizedEntries[]> {
  // The LLM assigns scopes fresh
  const cleanEntries = entries.map((e) => ({ ...e, scope: undefined }));

  return (result) => {
    const parsed = parseLLMResult(result);
    if (!parsed.ok) {
      return { valid: false, error: parsed.error };
    }

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

    const categoryError = checkCategoryNames(
      zodResult.data.entries,
      context.categories?.map((c) => c.name),
    );
    if (categoryError) {
      return { valid: false, error: categoryError };
    }

    const withScopes: ChangelogEntry[] = cleanEntries.map((entry, i) => {
      const llmEntry = zodResult.data.entries[i];
      const scope = llmEntry?.scope ?? undefined;
      return scope ? { ...entry, scope } : entry;
    });

    const scopeResult = validateEntryScopes(withScopes, context.scopes, context.categories, context.packageNames);
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
      // Strip scopes since the LLM run never produced validated values.
      return [{ category: 'General', entries: entries.map((e) => ({ ...e, scope: undefined })) }];
    }
    throw error;
  }
}
