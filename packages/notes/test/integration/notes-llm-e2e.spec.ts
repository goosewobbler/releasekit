import { describe, expect, it } from 'vitest';
import type { ChangelogEntry } from '../../src/core/types.js';
import { OllamaProvider } from '../../src/llm/ollama.js';
import { enhanceAndCategorize } from '../../src/llm/tasks/enhance-and-categorize.js';
import { generateReleaseNotes } from '../../src/llm/tasks/release-notes.js';
import { summarizeEntries } from '../../src/llm/tasks/summarize.js';

/**
 * Opt-in real-provider e2e for the LLM notes pipeline. The unit specs drive a mock provider and verify
 * the plumbing; this exercises the reliability changes against a *real* Ollama server, where mocks can
 * only approximate the API shape — chunking across the >30-entry boundary (two real structured calls +
 * a merge), the structured task path, and the free-text task path (summarize / release notes).
 *
 * Skipped by default so the gate stays fast and offline. To run (needs a reachable Ollama with the
 * model pulled):
 *   RELEASEKIT_NOTES_E2E=1 [RELEASEKIT_NOTES_E2E_MODEL=llama3.2] [OLLAMA_BASE_URL=http://localhost:11434] \
 *     pnpm --filter @releasekit/notes test
 *
 * Assertions check structure, not content — LLM output is non-deterministic. Even when the model
 * mangles a structured response, the pipeline's per-chunk fallback preserves every entry, so the
 * counts below hold regardless of model quality; the point is that the real provider path runs end to
 * end without hanging or dropping entries.
 */
const E2E_ENABLED = process.env.RELEASEKIT_NOTES_E2E === '1' || process.env.RELEASEKIT_NOTES_E2E === 'true';
const MODEL = process.env.RELEASEKIT_NOTES_E2E_MODEL ?? 'llama3.2';
const context = { packageName: 'my-lib', version: '2.0.0', previousVersion: '1.0.0' };

describe.skipIf(!E2E_ENABLED)('notes LLM e2e (real Ollama)', () => {
  const provider = new OllamaProvider({ model: MODEL });

  it('should enhance and categorize a large release across chunk boundaries', async () => {
    // 35 entries crosses the 30-entry chunk boundary → two real structured calls, then a category merge.
    const entries: ChangelogEntry[] = Array.from({ length: 35 }, (_, i) => ({
      type: i % 2 === 0 ? 'fixed' : 'added',
      description: `${i % 2 === 0 ? 'Fix' : 'Add'} behaviour ${i} in the widget subsystem`,
    }));

    const result = await enhanceAndCategorize(provider, entries, context);

    // Every input entry is accounted for exactly once (enhanced or fallback-preserved), with non-empty
    // descriptions, and lands in some non-empty category.
    expect(result.enhancedEntries).toHaveLength(35);
    expect(result.enhancedEntries.every((e) => typeof e.description === 'string' && e.description.length > 0)).toBe(
      true,
    );
    expect(result.categories.length).toBeGreaterThan(0);
    const categorized = result.categories.reduce((total, c) => total + c.entries.length, 0);
    expect(categorized).toBe(35);
  }, 180_000);

  it('should produce a prose summary and release notes via the text path', async () => {
    const entries: ChangelogEntry[] = [
      { type: 'added', description: 'Add deeplink support for the mobile client' },
      { type: 'fixed', description: 'Fix a crash when the config file is missing' },
    ];

    const summary = await summarizeEntries(provider, entries, context);
    expect(summary.trim().length).toBeGreaterThan(0);

    const notes = await generateReleaseNotes(provider, entries, context);
    expect(notes.trim().length).toBeGreaterThan(0);
  }, 180_000);
});
