import type { ChangelogEntry, LLMCategory } from '../../core/types.js';
import { extractJsonFromResponse } from '../../utils/json.js';
import type { ValidationResult } from '../correctiveRetry.js';
import { withCorrectiveRetry } from '../correctiveRetry.js';
import { renderExamplesBlock } from '../examples/parser.js';
import type { CategorizeContext, CategorizedEntries, EnhanceContext, LLMProvider } from '../index.js';
import type { CompleteResult, LLMMessage } from '../messages.js';
import { resolveSystemPrompt } from '../prompts.js';
import { buildEnhanceAndCategorizeSchema, EnhanceAndCategorizeOutputSchema } from '../schemas.js';
import { validateEntryScopes } from '../scopes.js';
import { groupByCategory } from './shared.js';

interface CombinedResult {
  enhancedEntries: ChangelogEntry[];
  categories: CategorizedEntries[];
}

function buildSystemPrompt(categories: LLMCategory[] | undefined, style: string | undefined): string {
  const styleText = style || 'Use present tense ("Add feature" not "Added feature"). Be concise.';

  const categorySection = categories
    ? `Categories (use ONLY these exact names):\n${categories
        .map((c) => {
          const scopeInfo = c.scopes?.length ? ` Allowed scopes: ${c.scopes.join(', ')}.` : '';
          return `- "${c.name}": ${c.description}${scopeInfo}`;
        })
        .join('\n')}`
    : `Categories: Group into meaningful categories (e.g., "New", "Fixed", "Changed", "Removed").`;

  let scopeInstruction = '';
  if (categories) {
    const withScopes = categories.filter((c) => c.scopes?.length);
    if (withScopes.length > 0) {
      const parts = withScopes.map((c) => `For "${c.name}" entries, use a scope from: ${c.scopes?.join(', ')}.`);
      scopeInstruction = `\n${parts.join('\n')}\nOnly use scopes from these predefined lists. Set scope to null if no scope applies.`;
    }
  }

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
    .map((e, i) => `${i}. [${e.type}]${e.scope ? ` (${e.scope})` : ''}: ${e.description}`)
    .join('\n');
  return `Entries:\n${entriesText}`;
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
  context: EnhanceContext & CategorizeContext,
): (result: CompleteResult) => ValidationResult<CombinedResult> {
  return (result) => {
    // Parse JSON (structured output or text fallback)
    let parsed: unknown;
    try {
      parsed =
        typeof result.structured !== 'undefined'
          ? result.structured
          : JSON.parse(extractJsonFromResponse(result.content));
    } catch (e) {
      return { valid: false, error: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}` };
    }

    // Validate structure
    const zodResult = EnhanceAndCategorizeOutputSchema.safeParse(parsed);
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

    // Validate scopes
    const scopeResult = validateEntryScopes(enhancedEntries, context.scopes, context.categories);
    if (!scopeResult.valid) {
      const msg = scopeResult.errors
        .map(
          (e) =>
            `entry ${e.entryIndex} scope "${e.providedScope}" (${e.allowedScopes.length ? `valid: ${e.allowedScopes.join(', ')}` : 'no scopes permitted'})`,
        )
        .join('; ');
      return { valid: false, error: `Invalid scopes: ${msg}` };
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

  const schema = buildEnhanceAndCategorizeSchema(context.categories ?? []);
  const validate = makeValidator(entries, context);

  return withCorrectiveRetry(
    (messages, isFirstAttempt) =>
      provider.complete(messages, isFirstAttempt ? { schema, toolName: 'emit_release_notes' } : undefined),
    validate,
    buildCorrectionMessages,
    initialMessages,
  );
}
