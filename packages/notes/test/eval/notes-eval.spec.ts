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

/**
 * Golden-fixture eval for the LLM-notes pipeline. Runs a real commit set through the real pipeline and
 * checks the output against deterministic quality assertions. By default the provider response is
 * replayed from a committed cache fixture (no keys, deterministic); with RELEASEKIT_EVAL=1 it runs a
 * live model, and with RELEASEKIT_EVAL_RECORD=1 it re-seeds the fixture from the recorded markdown.
 * The assertions are the regression net — they hold whether the response is replayed or freshly
 * generated, so a prompt or post-processing change that degrades output is caught.
 */
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

      // Structured-path checks the free-text case can't reach: the grouping has to discriminate, and
      // nothing may be lost or duplicated on the way through categorization.
      expect(checkNoEntryLoss(categories, golden.entries.length)).toEqual([]);
      expect(checkCategoryDistribution(categories)).toEqual([]);

      // The content assertions hold here too — the descriptions are user-facing prose.
      const descriptions = enhancedEntries.map((e) => `- ${e.description}`).join('\n');
      expect(findMarkerLeaks(descriptions)).toEqual([]);
      expect(findDuplicateDependencyChurn(descriptions)).toEqual([]);
      expect(checkPastTenseLeaning(descriptions)).toEqual([]);

      // Enhancement must rewrite the conventional-commit prefixes out, not pass them through.
      expect(descriptions).not.toMatch(/\b(feat|fix|chore|refactor)\(/);
    },
    isLiveMode ? 180_000 : 10_000,
  );

  // Guards the one thing that makes record→replay work at all. Capabilities decide whether a task
  // sends a structured-output schema/toolName, and those are part of the cache key — so a live
  // recording made under the real provider's capabilities would key differently from the replay that
  // has to read it back. Ollama advertises structuredOutputs: true, so this fails the moment the
  // wrapper passes the base provider's capabilities through instead of the harness's fixed set.
  it('should report the fixed eval capabilities regardless of what the live provider advertises', () => {
    const ollamaLike: LLMProvider = {
      name: 'ollama',
      capabilities: { systemRole: true, structuredOutputs: true, toolUse: false, honorsTemperature: true },
      complete: async (): Promise<CompleteResult> => ({ content: '' }),
    };

    expect(asEvalProvider(ollamaLike, 'unused', 'test').capabilities).toEqual(CAPABILITIES);
  });
});
