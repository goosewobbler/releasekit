import type { LLMPromptsConfig } from '../core/types.js';

export type TaskName = 'enhance' | 'categorize' | 'enhanceAndCategorize' | 'summarize' | 'releaseNotes';

/**
 * Resolve the final system prompt for an LLM task.
 *
 * Appends the user's `prompts.instructions[task]` to the default system prompt
 * when set. Full-template replacement is intentionally not supported — users
 * wanting bespoke rendering should use the output template system instead.
 */
export function resolveSystemPrompt(
  taskName: TaskName,
  defaultSystemPrompt: string,
  promptsConfig?: LLMPromptsConfig,
): string {
  const instructions = promptsConfig?.instructions?.[taskName];
  if (instructions) {
    return `${defaultSystemPrompt}\n\nAdditional instructions:\n${instructions}`;
  }
  return defaultSystemPrompt;
}
