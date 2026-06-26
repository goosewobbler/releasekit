import { warn } from '@releasekit/core';
import type { ChangelogEntry, LLMCategory } from '../../core/types.js';
import { LLMError } from '../../errors/index.js';
import { renderExamplesBlock } from '../examples/parser.js';
import type { CategorizeContext, CategorizedEntries, EnhanceContext, LLMProvider } from '../index.js';
import type { LLMMessage } from '../messages.js';
import { resolveSystemPrompt } from '../prompts.js';
import { buildEnhanceAndCategorizeSchema, EnhanceAndCategorizeOutputSchema } from '../schemas.js';
import { validateEntryScopes } from '../scopes.js';
import {
  buildCategorySection,
  checkCategoryNames,
  groupByCategory,
  parseLLMResult,
  renderPRBlocks,
  renderScopeInstruction,
  runCorrectiveTask,
  type TaskValidator,
} from './shared.js';

export interface CombinedResult {
  enhancedEntries: ChangelogEntry[];
  categories: CategorizedEntries[];
}

function buildSystemPrompt(categories: LLMCategory[] | undefined, style: string | undefined): string {
  const styleText = style || 'Use past tense ("Added feature" not "Add feature"). Be concise.';

  const categorySection = buildCategorySection(
    categories,
    `Categories: Group into meaningful categories (e.g., "New", "Fixed", "Changed", "Removed").`,
  );

  // Scope source: categories whose own `scopes` array is non-empty.
  const pairs =
    categories && categories.length > 0
      ? categories.filter((c) => c.scopes?.length).map((c) => ({ name: c.name, scopes: c.scopes! }))
      : [];
  const scopeInstruction = renderScopeInstruction(pairs, ' entries');

  return `You are generating release notes for a software project. Given changelog entries, rewrite each as a clear user-friendly description and categorize it.

Style guidelines:
- ${styleText}
- Be concise (1 short sentence per entry)
- Focus on what changed, not implementation details

${categorySection}${scopeInstruction}

leadIn guidelines:
- Set leadIn ONLY when an entry introduces a named API, feature, or concept worth scanning for (e.g. "Deeplink testing", "browser.electron.triggerDeeplink()")
- Leave leadIn null for routine fixes, dependency bumps, small tweaks, and refactors

Output a JSON object with an "entries" array. Each element (same order as input) must have:
- "description": rewritten user-friendly text
- "category": category name (from the list above)
- "scope": subcategory label or null
- "breaking": true if this is a breaking change, false or null otherwise
- "leadIn": short noun phrase for scanning (e.g. "Streaming API") or null`;
}

function buildUserPrompt(entries: ChangelogEntry[]): string {
  const entriesText = entries
    .map((e, i) => {
      const prBlocks = renderPRBlocks(e);
      const header = `${i}. [${e.type}]${e.scope ? ` (${e.scope})` : ''}: ${e.description}`;
      return prBlocks ? `${header}\n${prBlocks}` : header;
    })
    .join('\n');
  return `Entries:\n${entriesText}`;
}

export function createEnhanceAndCategorizeValidator(
  entries: ChangelogEntry[],
  context: EnhanceContext & CategorizeContext,
): TaskValidator<CombinedResult> {
  return (result) => {
    // Parse JSON (structured output or text fallback)
    const parsed = parseLLMResult(result);
    if (!parsed.ok) return { valid: false, error: parsed.error };

    // Validate structure
    const zodResult = EnhanceAndCategorizeOutputSchema.safeParse(parsed.data);
    if (!zodResult.success) {
      return { valid: false, error: `Schema error: ${zodResult.error.message}` };
    }

    const receivedCount = zodResult.data.entries.length;
    if (receivedCount < entries.length) {
      return {
        valid: false,
        error: `Expected ${entries.length} entries, got ${receivedCount} (entries missing — cannot proceed)`,
      };
    }
    if (receivedCount > entries.length) {
      warn(`LLM returned ${receivedCount} entries for ${entries.length} inputs; truncating to expected count.`);
      zodResult.data.entries.length = entries.length;
    }

    // Validate category names when categories are configured
    const categoryError = checkCategoryNames(
      zodResult.data.entries,
      context.categories?.map((c) => c.name),
    );
    if (categoryError) return { valid: false, error: categoryError };

    // Build enhanced entries
    const enhancedEntries: ChangelogEntry[] = entries.map((original, i) => {
      const llmEntry = zodResult.data.entries[i];
      if (!llmEntry) return original;
      return {
        ...original,
        description: llmEntry.description,
        scope: llmEntry.scope ?? undefined,
        breaking: llmEntry.breaking ?? original.breaking,
        leadIn: llmEntry.leadIn ?? undefined,
      };
    });

    // Validate scopes. The validator applies `invalidScopeAction` (default `remove`) and
    // returns `valid: true` once the action has been applied — we don't retry the LLM for
    // scope mismatches, since the configured action defines the resolution. We do surface a
    // warning so users can see which scopes the LLM produced that didn't match the allow list.
    const scopeResult = validateEntryScopes(enhancedEntries, context.scopes, context.categories, context.packageNames);
    if (scopeResult.errors.length > 0) {
      const offenders = [...new Set(scopeResult.errors.map((e) => e.providedScope))];
      warn(
        `LLM returned ${scopeResult.errors.length} entries with disallowed scopes (${offenders.join(', ')}); resolved per invalidScopeAction.`,
      );
    }

    const categories = groupByCategory(zodResult.data.entries, scopeResult.entries);

    return {
      valid: true,
      value: { enhancedEntries: scopeResult.entries, categories },
    };
  };
}

export async function enhanceAndCategorize(
  provider: LLMProvider,
  entries: ChangelogEntry[],
  context: EnhanceContext & CategorizeContext,
): Promise<CombinedResult> {
  if (entries.length === 0) {
    return { enhancedEntries: [], categories: [] };
  }

  const basePrompt = buildSystemPrompt(context.categories, context.style);
  const examplesBlock = renderExamplesBlock(context.examples ?? []);
  const systemPrompt = resolveSystemPrompt(
    'enhanceAndCategorize',
    examplesBlock ? `${basePrompt}${examplesBlock}` : basePrompt,
    context.prompts,
  );

  const initialMessages: LLMMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: buildUserPrompt(entries) },
  ];

  try {
    return await runCorrectiveTask({
      provider,
      initialMessages,
      schema: buildEnhanceAndCategorizeSchema(context.categories ?? []),
      toolName: 'emit_release_notes',
      validate: createEnhanceAndCategorizeValidator(entries, context),
    });
  } catch (error) {
    if (error instanceof LLMError) {
      warn(`enhanceAndCategorize failed after all attempts: ${error.message}. Returning entries ungrouped.`);
      // Triggered by structural validation failures the LLM couldn't recover from across the
      // retry budget: malformed JSON, schema-incompatible output, wrong entry count, or
      // categories outside the configured list. (Disallowed scopes don't reach here — the
      // configured invalidScopeAction resolves them in-place.) Strip the original entries'
      // scope/leadIn since the LLM run never produced validated values for either.
      const stripped = entries.map((e) => ({ ...e, scope: undefined, leadIn: undefined }));
      return { enhancedEntries: stripped, categories: [{ category: 'General', entries: stripped }] };
    }
    throw error;
  }
}
