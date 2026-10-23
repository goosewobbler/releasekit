import { describe, expect, it } from 'vitest';
import type { CategorizeContext, EnhanceContext } from '../../src/llm/index.js';
import type { CompleteResult, LLMProvider } from '../../src/llm/provider.js';
import { enhanceAndCategorize } from '../../src/llm/tasks/enhance-and-categorize.js';
import { generateReleaseNotes } from '../../src/llm/tasks/release-notes.js';
import {
  checkCategoryDistribution,
  checkLengthBounds,
  checkNoEntryLoss,
  checkPastTenseLeaning,
  findDuplicateDependencyChurn,
  findMarkerLeaks,
} from './assertions.js';
import { asEvalProvider, CAPABILITIES, evalProvider, isLiveMode, loadGoldenCase } from './harness.js';

describe('notes eval: release notes', () => {
  it(
    'should generate clean release notes for the basic golden case',
    async () => {
      const golden = loadGoldenCase('release-notes-basic');
      const provider = await evalProvider('release-notes-basic');

      const notes = await generateReleaseNotes(provider, golden.entries, golden.context);

      expect(findMarkerLeaks(notes)).toEqual([]);
      expect(findDuplicateDependencyChurn(notes)).toEqual([]);
      expect(checkLengthBounds(notes, 80, 4000)).toEqual([]);
      expect(checkPastTenseLeaning(notes)).toEqual([]);
    },
    isLiveMode ? 180_000 : 10_000,
  );

  it(
    'should enhance and categorize the structured golden case into a usable grouping',
    async () => {
      const golden = loadGoldenCase<EnhanceContext & CategorizeContext>('enhance-and-categorize-basic');
      const provider = await evalProvider('enhance-and-categorize-basic');

      const { enhancedEntries, categories } = await enhanceAndCategorize(provider, golden.entries, golden.context);

      // Eval capabilities advertise no structured outputs, so this covers the text → JSON parse path,
      // not the schema/tool-call branch.
      expect(checkNoEntryLoss(categories, enhancedEntries, golden.entries.length)).toEqual([]);
      expect(checkCategoryDistribution(categories)).toEqual([]);

      // A disallowed scope in any category means grouping used the unvalidated response.
      const allowedScopes = golden.context.scopes?.rules?.allowed ?? [];
      const leakedScopes = categories
        .flatMap((c) => c.entries)
        .map((e) => e.scope)
        .filter((scope) => scope !== undefined && !allowedScopes.includes(scope));
      expect(leakedScopes).toEqual([]);

      const descriptions = enhancedEntries.map((e) => `- ${e.description}`).join('\n');
      expect(findMarkerLeaks(descriptions)).toEqual([]);
      expect(findDuplicateDependencyChurn(descriptions)).toEqual([]);
      expect(checkPastTenseLeaning(descriptions)).toEqual([]);

      // Match only this case's labels, so a real lead-in like "CLI: …" doesn't count.
      const labels = [...new Set(golden.entries.flatMap((e) => [e.type, e.originalType, e.scope]))].filter(
        (label): label is string => typeof label === 'string' && label.length > 0,
      );
      const alternatives = labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
      const prefixLeak = new RegExp(`^- (?:${alternatives})(?:\\([^)]*\\))?!?:\\s`, 'im');
      expect(descriptions).not.toMatch(prefixLeak);
    },
    isLiveMode ? 180_000 : 10_000,
  );

  it('should report the fixed eval capabilities regardless of what the live provider advertises', () => {
    const ollamaLike: LLMProvider = {
      name: 'ollama',
      capabilities: { systemRole: true, structuredOutputs: true, toolUse: false, honorsTemperature: true },
      complete: async (): Promise<CompleteResult> => ({ content: '' }),
    };

    expect(asEvalProvider(ollamaLike, 'unused', 'test').capabilities).toEqual(CAPABILITIES);
  });
});
