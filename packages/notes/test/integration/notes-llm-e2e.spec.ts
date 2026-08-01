import { beforeAll, describe, expect, it, type TestContext } from 'vitest';
import type { ChangelogEntry } from '../../src/core/types.js';
import { LLM_DEFAULTS } from '../../src/llm/defaults.js';
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

// Read from the source of truth so the case keeps straddling the boundary if the chunk size moves.
const CHUNK_SIZE = LLM_DEFAULTS.enhanceCategorizeChunkSize;
const ENTRY_COUNT = CHUNK_SIZE + 5;

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

  // enhanceAndCategorize never throws on a provider failure — its per-chunk fallback preserves the
  // input entries — so nothing downstream can tell "the model declined to rewrite" from "the model
  // wasn't there". A cheap completion answers that directly, and is the only thing that can.
  async function probeReachability(): Promise<string | undefined> {
    try {
      await provider.complete([{ role: 'user', content: 'ping' }], { maxTokens: 1 });
      return undefined;
    } catch (error) {
      if (!isProviderUnreachable(error)) throw error;
      return error instanceof Error ? error.message : String(error);
    }
  }

  // Established up front so the assertions below can be strict about the model having done work.
  let unreachable: string | undefined;

  beforeAll(async () => {
    unreachable = await probeReachability();
  }, 120_000);

  function skipIfUnreachable(ctx: TestContext): void {
    if (unreachable === undefined) return;
    console.warn(`[notes-e2e] SKIPPED: provider unreachable — ${unreachable}`);
    ctx.skip();
  }

  it('should enhance and categorize a large release across chunk boundaries', async (ctx) => {
    skipIfUnreachable(ctx);

    // Crosses the chunk boundary → two real structured calls, then a category merge.
    const entries: ChangelogEntry[] = Array.from({ length: ENTRY_COUNT }, (_, i) => ({
      type: i % 2 === 0 ? 'fixed' : 'added',
      description: `${i % 2 === 0 ? 'Fix' : 'Add'} behaviour ${i} in the widget subsystem`,
    }));

    const result = await callProvider(ctx, 'enhanceAndCategorize', () =>
      enhanceAndCategorize(provider, entries, context),
    );

    // The model has to have actually rewritten something — the fallback returns descriptions verbatim,
    // so entry counts alone hold just as well with no provider at all. Counted per chunk rather than
    // over the whole set: chunks fall back independently, so a healthy first chunk would otherwise mask
    // a second that got nothing, which is exactly what a mid-run outage looks like at the boundary this
    // test exists to cover.
    const rewrittenIn = (from: number, to: number) =>
      result.enhancedEntries.slice(from, to).filter((e, i) => e.description !== entries[from + i]?.description).length;
    const firstChunk = rewrittenIn(0, CHUNK_SIZE);
    const lastChunk = rewrittenIn(CHUNK_SIZE, entries.length);

    // Either chunk coming back untouched is ambiguous: the fallback produces exactly that when the host
    // goes away mid-run, and the up-front probe can't see an outage that starts after it. Ask again
    // before calling it a regression, so a blocking red always means releasekit broke.
    if (firstChunk === 0 || lastChunk === 0) {
      const wentAway = await probeReachability();
      if (wentAway) {
        console.warn(`[notes-e2e] SKIPPED mid-run: provider became unreachable — ${wentAway}`);
        // A runtime skip on a proven outage, not a test parked with .skip — .todo() would disable it
        // permanently, which is the opposite of the intent.
        // eslint-disable-next-line vitest/no-disabled-tests
        ctx.skip();
      }
    }

    expect(firstChunk).toBeGreaterThan(0);
    expect(lastChunk).toBeGreaterThan(0);

    // Every input entry is accounted for exactly once (enhanced or fallback-preserved), with non-empty
    // descriptions, and lands in some non-empty category.
    expect(result.enhancedEntries).toHaveLength(ENTRY_COUNT);
    expect(result.enhancedEntries.every((e) => typeof e.description === 'string' && e.description.length > 0)).toBe(
      true,
    );
    expect(result.categories.length).toBeGreaterThan(0);
    const categorized = result.categories.reduce((total, c) => total + c.entries.length, 0);
    expect(categorized).toBe(ENTRY_COUNT);
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
