import { warn } from '@releasekit/core';
import type { ChangelogEntry, LLMCategory } from '../../core/types.js';
import { LLMError } from '../../errors/index.js';
import { extractJsonFromResponse } from '../../utils/json.js';
import type { ValidationResult } from '../correctiveRetry.js';
import { withCorrectiveRetry } from '../correctiveRetry.js';
import type { CategorizeContext, CategorizedEntries, LLMProvider } from '../index.js';
import type { CompleteResult, LLMMessage } from '../messages.js';
import { resolveSystemPrompt } from '../prompts.js';
import { buildCategorizeSchema, CategorizeOutputSchema } from '../schemas.js';
import { getAllowedScopesFromCategories, validateEntryScopes } from '../scopes.js';
import { groupByCategory } from './shared.js';

function buildSystemPrompt(categories: LLMCategory[] | undefined): string {
  const categorySection =
    categories && categories.length > 0
      ? `Categories (use ONLY these exact names):\n${categories
          .map((c) => {
            const scopeInfo = c.scopes?.length ? ` Allowed scopes: ${c.scopes.join(', ')}.` : '';
            return `- "${c.name}": ${c.description}${scopeInfo}`;
          })
          .join('\n')}`
      : `Categories: Group into meaningful categories (e.g., "Core", "UI", "API", "Performance", "Bug Fixes", "Documentation").`;

  let scopeInstruction = '';
  if (categories && categories.length > 0) {
    const scopeMap = getAllowedScopesFromCategories(categories);
    if (scopeMap.size > 0) {
      const parts: string[] = [];
      for (const [catName, scopes] of scopeMap) {
        parts.push(`For "${catName}", use a scope from: ${scopes.join(', ')}.`);
      }
      scopeInstruction = `\n${parts.join('\n')}\nOnly use scopes from these predefined lists. Set scope to null if no scope applies.`;
    }
  }

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

function buildCorrectionMessages(_badContent: string, error: string): LLMMessage[] {
  return [
    {
      role: 'user',
      content: `Your previous response had an error: ${error}

Please fix the issue and output only valid JSON matching the required schema.`,
    },
  ];
}

function makeValidator(
  entries: ChangelogEntry[],
  context: CategorizeContext,
): (result: CompleteResult) => ValidationResult<CategorizedEntries[]> {
  // Work with a copy that has scopes cleared (LLM assigns them fresh)
  const cleanEntries = entries.map((e) => ({ ...e, scope: undefined }));

  return (result) => {
    let parsed: unknown;
    try {
      parsed =
        typeof result.structured !== 'undefined'
          ? result.structured
          : JSON.parse(extractJsonFromResponse(result.content));
    } catch (e) {
      return { valid: false, error: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}` };
    }

    const zodResult = CategorizeOutputSchema.safeParse(parsed);
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
    const categoryNames = context.categories?.map((c) => c.name);
    if (categoryNames?.length) {
      const invalid = zodResult.data.entries.filter((e) => !categoryNames.includes(e.category)).map((e) => e.category);
      if (invalid.length > 0) {
        const unique = [...new Set(invalid)];
        return {
          valid: false,
          error: `Unknown categories: ${unique.join(', ')}. Valid categories: ${categoryNames.join(', ')}`,
        };
      }
    }

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

  const schema = buildCategorizeSchema(context.categories ?? []);
  const validate = makeValidator(entries, context);

  try {
    return await withCorrectiveRetry(
      (messages, isFirstAttempt) =>
        provider.complete(
          messages,
          isFirstAttempt && provider.capabilities.structuredOutputs
            ? { schema, toolName: 'categorize_entries' }
            : undefined,
        ),
      validate,
      buildCorrectionMessages,
      initialMessages,
    );
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
