import type { LLMPromptsConfig } from '../core/types.js';

export type TaskName = 'enhance' | 'categorize' | 'enhanceAndCategorize' | 'summarize' | 'releaseNotes';

/**
 * Resolve the final prompt for an LLM task.
 *
 * Priority:
 * 1. Full template replacement (`prompts.templates[task]`) — returns the user's template as-is.
 * 2. Additive instructions (`prompts.instructions[task]`) — injects additional instructions
 *    into the default prompt before the output format instruction.
 * 3. Default — returns the default prompt unchanged.
 */
export function resolvePrompt(taskName: TaskName, defaultPrompt: string, promptsConfig?: LLMPromptsConfig): string {
  if (!promptsConfig) return defaultPrompt;

  // Full template replacement takes highest priority
  const fullTemplate = promptsConfig.templates?.[taskName];
  if (fullTemplate) return fullTemplate;

  // Additive instructions: inject before the "Output only valid JSON" line
  const additionalInstructions = promptsConfig.instructions?.[taskName];
  if (additionalInstructions) {
    const insertionPoint = defaultPrompt.lastIndexOf('Output only valid JSON');
    if (insertionPoint !== -1) {
      return `${defaultPrompt.slice(0, insertionPoint)}Additional instructions:\n${additionalInstructions}\n\n${defaultPrompt.slice(insertionPoint)}`;
    }
    // For prompts without "Output only valid JSON" (e.g., enhance, releaseNotes), append
    return `${defaultPrompt}\n\nAdditional instructions:\n${additionalInstructions}`;
  }

  return defaultPrompt;
}
