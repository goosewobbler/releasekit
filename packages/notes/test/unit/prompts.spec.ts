import { describe, expect, it } from 'vitest';
import type { LLMPromptsConfig } from '../../src/core/types.js';
import { resolveSystemPrompt } from '../../src/llm/prompts.js';

const DEFAULT_SYSTEM_PROMPT = `You are categorizing entries.

Output a JSON object with an "entries" array.`;

// ---------------------------------------------------------------------------
// resolveSystemPrompt
// ---------------------------------------------------------------------------

describe('resolveSystemPrompt()', () => {
  it('should return default prompt when no config provided', () => {
    const result = resolveSystemPrompt('categorize', DEFAULT_SYSTEM_PROMPT);
    expect(result).toBe(DEFAULT_SYSTEM_PROMPT);
  });

  it('should return default prompt when config has no overrides for the task', () => {
    const config: LLMPromptsConfig = {
      instructions: { enhance: 'some instruction' },
    };
    const result = resolveSystemPrompt('categorize', DEFAULT_SYSTEM_PROMPT, config);
    expect(result).toBe(DEFAULT_SYSTEM_PROMPT);
  });

  it('should append additive instructions to the default system prompt', () => {
    const config: LLMPromptsConfig = {
      instructions: { categorize: 'Prefer Developer category for CI changes.' },
    };
    const result = resolveSystemPrompt('categorize', DEFAULT_SYSTEM_PROMPT, config);
    expect(result).toContain('Prefer Developer category for CI changes.');
    expect(result).toContain('Additional instructions:');
    expect(result.startsWith(DEFAULT_SYSTEM_PROMPT)).toBe(true);
  });

  it('should work for all task names', () => {
    for (const task of ['enhance', 'categorize', 'enhanceAndCategorize', 'summarize', 'releaseNotes'] as const) {
      const config: LLMPromptsConfig = {
        instructions: { [task]: `Custom instruction for ${task}` },
      };
      const result = resolveSystemPrompt(task, DEFAULT_SYSTEM_PROMPT, config);
      expect(result).toContain(`Custom instruction for ${task}`);
    }
  });

  it('should return default prompt when instructions config is undefined', () => {
    const config: LLMPromptsConfig = {};
    const result = resolveSystemPrompt('summarize', DEFAULT_SYSTEM_PROMPT, config);
    expect(result).toBe(DEFAULT_SYSTEM_PROMPT);
  });
});
