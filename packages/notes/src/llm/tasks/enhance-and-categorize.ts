import { warn } from '@releasekit/core';
import type { ChangelogEntry } from '../../core/types.js';
import type { CategorizeContext, CategorizedEntries, EnhanceContext, LLMProvider } from '../index.js';

interface CombinedResult {
  enhancedEntries: ChangelogEntry[];
  categories: CategorizedEntries[];
}

function buildPrompt(
  entries: ChangelogEntry[],
  categories: Array<{ name: string; description: string }> | undefined,
  style: string | undefined,
): string {
  const entriesText = entries
    .map((e, i) => `${i}. [${e.type}]${e.scope ? ` (${e.scope})` : ''}: ${e.description}`)
    .join('\n');

  const styleText = style || 'Use present tense ("Add feature" not "Added feature"). Be concise.';

  const categorySection = categories
    ? `Categories (use ONLY these):\n${categories.map((c) => `- "${c.name}": ${c.description}`).join('\n')}`
    : `Categories: Group into meaningful categories (e.g., "New", "Fixed", "Changed", "Removed").`;

  return `You are generating release notes for a software project. Given the following changelog entries, do two things:

1. **Rewrite** each entry as a clear, user-friendly description
2. **Categorize** each entry into the appropriate category

Style guidelines:
- ${styleText}
- Be concise (1 short sentence per entry)
- Focus on what changed, not implementation details

${categorySection}

${categories ? 'For entries in categories involving internal/developer changes, set a "scope" field with a short subcategory label (e.g., "CI", "Dependencies", "Testing").' : ''}

Entries:
${entriesText}

Output a JSON object with:
- "entries": array of objects, one per input entry (same order), each with: { "description": "rewritten text", "category": "CategoryName", "scope": "optional subcategory label or null" }

Output only valid JSON, nothing else:`;
}

export async function enhanceAndCategorize(
  provider: LLMProvider,
  entries: ChangelogEntry[],
  context: EnhanceContext & CategorizeContext,
): Promise<CombinedResult> {
  if (entries.length === 0) {
    return { enhancedEntries: [], categories: [] };
  }

  const prompt = buildPrompt(entries, context.categories, context.style);

  try {
    const response = await provider.complete(prompt);

    const cleaned = response
      .replace(/^```(?:json)?\n?/, '')
      .replace(/\n?```$/, '')
      .trim();
    const parsed = JSON.parse(cleaned);

    if (!Array.isArray(parsed.entries)) {
      throw new Error('Response missing "entries" array');
    }

    // Build enhanced entries
    const enhancedEntries: ChangelogEntry[] = entries.map((original, i) => {
      const result = parsed.entries[i];
      if (!result) return original;

      return {
        ...original,
        description: result.description || original.description,
        scope: result.scope || original.scope,
      };
    });

    // Group into categories
    const categoryMap = new Map<string, ChangelogEntry[]>();

    for (let i = 0; i < parsed.entries.length; i++) {
      const result = parsed.entries[i];
      const category = result?.category || 'General';
      const entry = enhancedEntries[i];
      if (!entry) continue;

      if (!categoryMap.has(category)) {
        categoryMap.set(category, []);
      }
      categoryMap.get(category)!.push(entry);
    }

    const categories: CategorizedEntries[] = [];
    for (const [category, catEntries] of categoryMap) {
      categories.push({ category, entries: catEntries });
    }

    return { enhancedEntries, categories };
  } catch (error) {
    warn(`Combined enhance+categorize failed: ${error instanceof Error ? error.message : String(error)}`);
    // Fall back to uncategorized original entries
    return {
      enhancedEntries: entries,
      categories: [{ category: 'General', entries }],
    };
  }
}
