import { describe, expect, it } from 'vitest';
import type { LLMPromptsConfig } from '../../src/core/types.js';
import { resolvePrompt } from '../../src/llm/prompts.js';

const DEFAULT_PROMPT_WITH_JSON = `You are categorizing entries.

Entries:
{{entries}}

Output only valid JSON, nothing else:`;

const DEFAULT_PROMPT_WITHOUT_JSON = `You are enhancing a changelog entry.

Original: {{description}}

Rewritten description (only output the new description, nothing else):`;

// ---------------------------------------------------------------------------
// resolvePrompt
// ---------------------------------------------------------------------------

describe('resolvePrompt()', () => {
  it('should return default prompt when no config provided', () => {
    const result = resolvePrompt('categorize', DEFAULT_PROMPT_WITH_JSON);
    expect(result).toBe(DEFAULT_PROMPT_WITH_JSON);
  });

  it('should return default prompt when config has no overrides for the task', () => {
    const config: LLMPromptsConfig = {
      instructions: { enhance: 'some instruction' },
    };
    const result = resolvePrompt('categorize', DEFAULT_PROMPT_WITH_JSON, config);
    expect(result).toBe(DEFAULT_PROMPT_WITH_JSON);
  });

  it('should return full template replacement when templates[task] is set', () => {
    const customTemplate = 'My custom categorize prompt: {{entries}}';
    const config: LLMPromptsConfig = {
      templates: { categorize: customTemplate },
    };
    const result = resolvePrompt('categorize', DEFAULT_PROMPT_WITH_JSON, config);
    expect(result).toBe(customTemplate);
  });

  it('injects additive instructions before "Output only valid JSON"', () => {
    const config: LLMPromptsConfig = {
      instructions: { categorize: 'Prefer Developer category for CI changes.' },
    };
    const result = resolvePrompt('categorize', DEFAULT_PROMPT_WITH_JSON, config);
    expect(result).toContain('Additional instructions:\nPrefer Developer category for CI changes.');
    expect(result).toContain('Output only valid JSON, nothing else:');
    // Instructions should appear BEFORE the output format instruction
    const instructionIdx = result.indexOf('Additional instructions:');
    const outputIdx = result.indexOf('Output only valid JSON');
    expect(instructionIdx).toBeLessThan(outputIdx);
  });

  it('appends additive instructions for prompts without JSON output line', () => {
    const config: LLMPromptsConfig = {
      instructions: { enhance: 'Use active voice.' },
    };
    const result = resolvePrompt('enhance', DEFAULT_PROMPT_WITHOUT_JSON, config);
    expect(result).toContain('Additional instructions:\nUse active voice.');
    expect(result.startsWith(DEFAULT_PROMPT_WITHOUT_JSON)).toBe(true);
  });

  it('template replacement takes priority over instructions', () => {
    const customTemplate = 'Full replacement prompt';
    const config: LLMPromptsConfig = {
      templates: { categorize: customTemplate },
      instructions: { categorize: 'This should be ignored' },
    };
    const result = resolvePrompt('categorize', DEFAULT_PROMPT_WITH_JSON, config);
    expect(result).toBe(customTemplate);
    expect(result).not.toContain('This should be ignored');
  });

  it('should work for all task names', () => {
    for (const task of ['enhance', 'categorize', 'enhanceAndCategorize', 'summarize', 'releaseNotes'] as const) {
      const config: LLMPromptsConfig = {
        instructions: { [task]: `Custom instruction for ${task}` },
      };
      const result = resolvePrompt(task, DEFAULT_PROMPT_WITHOUT_JSON, config);
      expect(result).toContain(`Custom instruction for ${task}`);
    }
  });
});
