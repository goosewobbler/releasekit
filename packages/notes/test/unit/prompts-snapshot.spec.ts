import { describe, expect, it } from 'vitest';
import { buildSystemPrompt as buildCategorizeSystemPrompt } from '../../src/llm/tasks/categorize.js';
import { buildSystemPrompt as buildEnhanceSystemPrompt } from '../../src/llm/tasks/enhance.js';
import { buildSystemPrompt as buildEnhanceAndCategorizeSystemPrompt } from '../../src/llm/tasks/enhance-and-categorize.js';
import { DEFAULT_SYSTEM_PROMPT as RELEASE_NOTES_PROMPT } from '../../src/llm/tasks/release-notes.js';
import { DEFAULT_SYSTEM_PROMPT as SUMMARIZE_PROMPT } from '../../src/llm/tasks/summarize.js';

/**
 * Snapshots of the default task system prompts. A prompt is the highest-leverage, least-visible input
 * to LLM notes — a wording tweak reshapes every generation and silently busts the response cache, yet
 * never shows up as a reviewable diff on its own. Pinning each here makes prompt drift an explicit,
 * reviewed event: an intentional edit updates the snapshot in the same PR; an accidental one fails CI.
 *
 * Snapshotted with default (unconfigured) inputs, so the snapshot captures the base prompt, not a
 * user's category/style overrides.
 */
describe('task system prompt snapshots', () => {
  it('should match the enhance system prompt', () => {
    expect(buildEnhanceSystemPrompt(undefined)).toMatchSnapshot();
  });

  it('should match the categorize system prompt', () => {
    expect(buildCategorizeSystemPrompt(undefined)).toMatchSnapshot();
  });

  it('should match the enhanceAndCategorize system prompt', () => {
    expect(buildEnhanceAndCategorizeSystemPrompt(undefined, undefined)).toMatchSnapshot();
  });

  it('should match the releaseNotes system prompt', () => {
    expect(RELEASE_NOTES_PROMPT).toMatchSnapshot();
  });

  it('should match the summarize system prompt', () => {
    expect(SUMMARIZE_PROMPT).toMatchSnapshot();
  });
});
