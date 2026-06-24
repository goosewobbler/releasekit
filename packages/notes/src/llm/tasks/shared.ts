import type { ChangelogEntry, JSONSchema, LLMCategory } from '../../core/types.js';
import { extractJsonFromResponse } from '../../utils/json.js';
import type { ValidationResult } from '../correctiveRetry.js';
import { withCorrectiveRetry } from '../correctiveRetry.js';
import type { CategorizedEntries } from '../index.js';
import type { CompleteResult, LLMMessage } from '../messages.js';
import type { LLMProvider } from '../provider.js';

export function escAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
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

/**
 * Renders the "Categories" section of a task system prompt. When categories are
 * configured it lists each name/description (plus any allowed scopes); otherwise
 * it returns the task-specific free-form `fallback` instruction.
 */
export function buildCategorySection(categories: LLMCategory[] | undefined, fallback: string): string {
  if (!categories || categories.length === 0) return fallback;
  const lines = categories.map((c) => {
    const scopeInfo = c.scopes?.length ? ` Allowed scopes: ${c.scopes.join(', ')}.` : '';
    return `- "${c.name}": ${c.description}${scopeInfo}`;
  });
  return `Categories (use ONLY these exact names):\n${lines.join('\n')}`;
}

/**
 * Renders the per-category scope instruction block. `entrySuffix` distinguishes
 * the two callers' wording (categorize: `For "X", …`; enhance: `For "X" entries, …`).
 * The scope-source resolution stays in each task — only the final rendering is shared.
 */
export function renderScopeInstruction(pairs: Array<{ name: string; scopes: string[] }>, entrySuffix: string): string {
  if (pairs.length === 0) return '';
  const parts = pairs.map((p) => `For "${p.name}"${entrySuffix}, use a scope from: ${p.scopes.join(', ')}.`);
  return `\n${parts.join('\n')}\nOnly use scopes from these predefined lists. Set scope to null if no scope applies.`;
}

export function buildCorrectionMessages(_badContent: string, error: string): LLMMessage[] {
  return [
    {
      role: 'user',
      content: `Your previous response had an error: ${error}

Please fix the issue and output only valid JSON matching the required schema.`,
    },
  ];
}

/**
 * Parses an LLM completion into a value, preferring structured output and
 * falling back to JSON extracted from the text content. Returns a discriminated
 * result so callers can surface the exact `Invalid JSON: …` error on failure.
 */
export function parseLLMResult(result: CompleteResult): { ok: true; data: unknown } | { ok: false; error: string } {
  try {
    const data =
      typeof result.structured !== 'undefined'
        ? result.structured
        : JSON.parse(extractJsonFromResponse(result.content));
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/**
 * Validates that every entry's category is one of the configured `categoryNames`.
 * Returns the error string (with the deduped offenders) or `null` when all are
 * valid or no categories are configured.
 */
export function checkCategoryNames(
  llmEntries: Array<{ category: string }>,
  categoryNames: string[] | undefined,
): string | null {
  if (!categoryNames?.length) return null;
  const invalid = llmEntries.filter((e) => !categoryNames.includes(e.category)).map((e) => e.category);
  if (invalid.length === 0) return null;
  const unique = [...new Set(invalid)];
  return `Unknown categories: ${unique.join(', ')}. Valid categories: ${categoryNames.join(', ')}`;
}

export type TaskValidator<T> = (result: CompleteResult) => ValidationResult<T>;

/**
 * Drives a structured-output task through `withCorrectiveRetry`: builds the
 * completion closure (passing schema/toolName only on the first attempt when the
 * provider supports structured outputs) and applies the per-task `validate`.
 */
export async function runCorrectiveTask<T>(opts: {
  provider: LLMProvider;
  initialMessages: LLMMessage[];
  schema: JSONSchema;
  toolName: string;
  validate: TaskValidator<T>;
}): Promise<T> {
  const { provider, initialMessages, schema, toolName, validate } = opts;
  return withCorrectiveRetry(
    (messages, isFirstAttempt) =>
      provider.complete(
        messages,
        isFirstAttempt && provider.capabilities.structuredOutputs ? { schema, toolName } : undefined,
      ),
    validate,
    buildCorrectionMessages,
    initialMessages,
  );
}
