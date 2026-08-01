import { beforeAll, describe, expect, it, type TestContext } from 'vitest';
import type { ChangelogEntry } from '../../src/core/types.js';
import { OllamaProvider } from '../../src/llm/ollama.js';
import { enhanceAndCategorize } from '../../src/llm/tasks/enhance-and-categorize.js';
import { generateReleaseNotes } from '../../src/llm/tasks/release-notes.js';
import { summarizeEntries } from '../../src/llm/tasks/summarize.js';
import { isProviderUnreachable } from './infra-tolerance.js';

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
 *
 * Infra-tolerant so this can be a blocking check without making a hosted model's uptime a merge gate:
 * an unreachable provider skips, everything else fails. See {@link isProviderUnreachable}.
 */
const E2E_ENABLED = process.env.RELEASEKIT_NOTES_E2E === '1' || process.env.RELEASEKIT_NOTES_E2E === 'true';
const MODEL = process.env.RELEASEKIT_NOTES_E2E_MODEL ?? 'llama3.2';
const context = { packageName: 'my-lib', version: '2.0.0', previousVersion: '1.0.0' };

/**
 * Run a provider call, skipping the test when the model host is unreachable. This check is meant to
 * block merges, so a red must mean "releasekit broke" and not "the host was down" — but the skip is
 * narrow ({@link isProviderUnreachable}) and loud, because a skip that swallows a regression defeats
 * the check entirely.
 *
 * Only the provider call is wrapped. Assertions run on the returned value in the caller, so a
 * wrong-output failure is never mistaken for infrastructure.
 */
async function callProvider<T>(ctx: TestContext, label: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (isProviderUnreachable(error)) {
      const detail = error instanceof Error ? error.message : String(error);
      console.warn(`[notes-e2e] SKIPPED ${label}: provider unreachable — ${detail}`);
      ctx.skip();
    }
    throw error;
  }
}

describe.skipIf(!E2E_ENABLED)('notes LLM e2e (real Ollama)', () => {
  const provider = new OllamaProvider({ model: MODEL });

  // Establish reachability once, up front, rather than inferring it from a failed assertion later.
  // enhanceAndCategorize never throws on a provider failure — its per-chunk fallback preserves the
  // input entries — so a test that only counts entries passes against a server that isn't there. The
  // probe is what lets the assertions below be strict about the model having actually done work.
  let unreachable: string | undefined;

  beforeAll(async () => {
    try {
      await provider.complete([{ role: 'user', content: 'ping' }], { maxTokens: 1 });
    } catch (error) {
      if (!isProviderUnreachable(error)) throw error;
      unreachable = error instanceof Error ? error.message : String(error);
    }
  }, 120_000);

  function skipIfUnreachable(ctx: TestContext): void {
    if (unreachable === undefined) return;
    console.warn(`[notes-e2e] SKIPPED: provider unreachable — ${unreachable}`);
    ctx.skip();
  }

  it('should enhance and categorize a large release across chunk boundaries', async (ctx) => {
    skipIfUnreachable(ctx);

    // 35 entries crosses the 30-entry chunk boundary → two real structured calls, then a category merge.
    const entries: ChangelogEntry[] = Array.from({ length: 35 }, (_, i) => ({
      type: i % 2 === 0 ? 'fixed' : 'added',
      description: `${i % 2 === 0 ? 'Fix' : 'Add'} behaviour ${i} in the widget subsystem`,
    }));

    const result = await callProvider(ctx, 'enhanceAndCategorize', () =>
      enhanceAndCategorize(provider, entries, context),
    );

    // The model has to have actually rewritten something. The fallback returns descriptions verbatim,
    // so without this the entry-count assertions below hold just as well with no provider at all.
    const rewritten = result.enhancedEntries.filter((e, i) => e.description !== entries[i]?.description);
    expect(rewritten.length).toBeGreaterThan(0);

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

  it('should produce a prose summary and release notes via the text path', async (ctx) => {
    skipIfUnreachable(ctx);

    const entries: ChangelogEntry[] = [
      { type: 'added', description: 'Add deeplink support for the mobile client' },
      { type: 'fixed', description: 'Fix a crash when the config file is missing' },
    ];

    const summary = await callProvider(ctx, 'summarizeEntries', () => summarizeEntries(provider, entries, context));
    expect(summary.trim().length).toBeGreaterThan(0);

    const notes = await callProvider(ctx, 'generateReleaseNotes', () =>
      generateReleaseNotes(provider, entries, context),
    );
    expect(notes.trim().length).toBeGreaterThan(0);
  }, 180_000);
});
