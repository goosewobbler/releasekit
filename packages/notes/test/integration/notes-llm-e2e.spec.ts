import { beforeAll, beforeEach, describe, expect, it, type TestContext } from 'vitest';
import type { ChangelogEntry } from '../../src/core/types.js';
import { LLM_DEFAULTS } from '../../src/llm/defaults.js';
import { OllamaProvider } from '../../src/llm/ollama.js';
import type { LLMProvider } from '../../src/llm/provider.js';
import { isRetryableLLMError } from '../../src/llm/retryable.js';
import { enhanceAndCategorize } from '../../src/llm/tasks/enhance-and-categorize.js';
import { generateReleaseNotes } from '../../src/llm/tasks/release-notes.js';
import { summarizeEntries } from '../../src/llm/tasks/summarize.js';
import { withRetry } from '../../src/utils/retry.js';
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
 * Under CI, OLLAMA_BASE_URL is required.
 *
 * Assertions check structure, not wording — LLM output is non-deterministic. Entry counts hold whatever
 * the model does, because the per-chunk fallback preserves every entry. The rewrite check does not:
 * each chunk must come back with at least one rewritten description, so a model that can't produce
 * valid structured output for a chunk (and falls back) fails this test. That is deliberate — the
 * fallback is indistinguishable from "no model at all" — and it means the configured model has to be
 * one that handles the schema.
 *
 * Infra-tolerant so this can be a blocking check without making a hosted model's uptime a merge gate:
 * a proven outage skips (with a `::warning::` annotation), everything else fails. See
 * {@link isProviderUnreachable}.
 */
const E2E_ENABLED = process.env.RELEASEKIT_NOTES_E2E === '1' || process.env.RELEASEKIT_NOTES_E2E === 'true';
const MODEL = process.env.RELEASEKIT_NOTES_E2E_MODEL ?? 'llama3.2';
const context = { packageName: 'my-lib', version: '2.0.0', previousVersion: '1.0.0' };

// Read from the source of truth so the case keeps straddling the boundary if the chunk size moves.
const CHUNK_SIZE = LLM_DEFAULTS.enhanceCategorizeChunkSize;
const ENTRY_COUNT = CHUNK_SIZE + 5;

// A host that hangs mid-run costs one call's whole retry budget before the breaker below trips:
// 3 attempts × 45s + backoff (1s + 2s, ±20%) ≈ 140s. The 240s test timeouts leave ~100s on top of that
// for the calls that succeeded before the hang. A host too slow for 45s a call times out and skips — loudly.
const CALL_TIMEOUT_MS = 45_000;

/** An error with its cause chain — `fetch failed` alone doesn't say what failed. */
function describeError(error: unknown): string {
  const chain: string[] = [];
  let e: unknown = error;
  for (let depth = 0; e !== undefined && depth < 5; depth++) {
    chain.push(e instanceof Error ? `${e.name}: ${e.message}` : String(e));
    e = e instanceof Error ? e.cause : undefined;
  }
  return chain.join(' ← ').replace(/\s+/g, ' ');
}

function skipUnreachable(ctx: TestContext, errors: unknown[]): never {
  // A GitHub Actions annotation (a single stdout line), so a blocking check that skipped shows on the run
  // summary instead of passing as quietly as a real green.
  console.log(`::warning title=notes LLM e2e skipped::provider unreachable — ${errors.map(describeError).join('; ')}`);
  return ctx.skip();
}

/**
 * Run a text-path task, skipping on a proven outage. Unlike enhanceAndCategorize these tasks have no
 * fallback — a provider failure propagates — so the thrown error is classified directly. Only the call is
 * wrapped: assertions run on its result in the caller, so wrong output is never mistaken for infra.
 */
async function callProvider<T>(ctx: TestContext, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (isProviderUnreachable(error)) skipUnreachable(ctx, [error]);
    throw error;
  }
}

describe.skipIf(!E2E_ENABLED)('notes LLM e2e (real Ollama)', () => {
  beforeAll(() => {
    // Unset, the provider dials localhost — always refused on a CI runner, which classifies as an outage.
    // A misconfigured check would then skip green on every run and never check anything.
    if (process.env.CI && !process.env.OLLAMA_BASE_URL) {
      throw new Error('OLLAMA_BASE_URL must be set when RELEASEKIT_NOTES_E2E runs under CI');
    }
  });

  const ollama = new OllamaProvider({ model: MODEL });

  // Per test. Errors that outlived the retry budget, kept for the test to classify: enhanceAndCategorize
  // falls back per chunk instead of throwing, so they're the only record of *why* a chunk came back
  // untouched. And a breaker: once a transient error has exhausted its retries, every later call rethrows
  // it at once, so a host that hangs costs the test one retry budget rather than one per call.
  let failures: unknown[] = [];
  let tripped: unknown;

  // Wrapped as the pipeline wraps it (src/core/pipeline.ts): a single 503, 429, reset or timeout is
  // retried and absorbed exactly as in a real release, rather than surfacing as a fallback.
  const provider: LLMProvider = {
    name: ollama.name,
    capabilities: ollama.capabilities,
    async complete(messages, options) {
      try {
        if (tripped !== undefined) throw tripped;
        return await withRetry(() => ollama.complete(messages, { ...options, timeout: CALL_TIMEOUT_MS }), {
          ...LLM_DEFAULTS.retry,
          shouldRetry: isRetryableLLMError,
        });
      } catch (error) {
        if (isRetryableLLMError(error)) tripped = error;
        failures.push(error);
        throw error;
      }
    },
  };

  beforeEach(() => {
    failures = [];
    tripped = undefined;
  });

  it('should enhance and categorize a large release across chunk boundaries', async (ctx) => {
    // Crosses the chunk boundary → two real structured calls, then a category merge.
    const entries: ChangelogEntry[] = Array.from({ length: ENTRY_COUNT }, (_, i) => ({
      type: i % 2 === 0 ? 'fixed' : 'added',
      description: `${i % 2 === 0 ? 'Fix' : 'Add'} behaviour ${i} in the widget subsystem`,
    }));

    const result = await enhanceAndCategorize(provider, entries, context);

    // The model has to have actually rewritten something — the fallback returns descriptions verbatim,
    // so entry counts alone hold just as well with no provider at all. Counted per chunk rather than
    // over the whole set: chunks fall back independently, so a healthy first chunk would otherwise mask
    // a second that got nothing, which is exactly what a mid-run outage looks like at the boundary this
    // test exists to cover.
    const rewrittenIn = (from: number, to: number) =>
      result.enhancedEntries.slice(from, to).filter((e, i) => e.description !== entries[from + i]?.description).length;
    const firstChunk = rewrittenIn(0, CHUNK_SIZE);
    const lastChunk = rewrittenIn(CHUNK_SIZE, entries.length);

    // An untouched chunk is either the host going away or releasekit breaking. Only the errors that
    // outlived the retries can tell which, and it's an outage only if every one of them proves it.
    const errors = [...new Set(failures)];
    if ((firstChunk === 0 || lastChunk === 0) && errors.length > 0 && errors.every(isProviderUnreachable)) {
      skipUnreachable(ctx, errors);
    }
    const why =
      errors.length > 0
        ? `provider errors: ${errors.map(describeError).join('; ')}`
        : 'no provider error, so its output failed validation or came back verbatim (see the warnings above)';
    expect(firstChunk, `chunk 1 (entries 1-${CHUNK_SIZE}) came back unrewritten; ${why}`).toBeGreaterThan(0);
    expect(
      lastChunk,
      `chunk 2 (entries ${CHUNK_SIZE + 1}-${ENTRY_COUNT}) came back unrewritten; ${why}`,
    ).toBeGreaterThan(0);

    // Every input entry is accounted for exactly once (enhanced or fallback-preserved), with non-empty
    // descriptions, and lands in some non-empty category.
    expect(result.enhancedEntries).toHaveLength(ENTRY_COUNT);
    expect(result.enhancedEntries.every((e) => typeof e.description === 'string' && e.description.length > 0)).toBe(
      true,
    );
    expect(result.categories.length).toBeGreaterThan(0);
    const categorized = result.categories.reduce((total, c) => total + c.entries.length, 0);
    expect(categorized).toBe(ENTRY_COUNT);
  }, 240_000);

  it('should produce a prose summary and release notes via the text path', async (ctx) => {
    const entries: ChangelogEntry[] = [
      { type: 'added', description: 'Add deeplink support for the mobile client' },
      { type: 'fixed', description: 'Fix a crash when the config file is missing' },
    ];

    const summary = await callProvider(ctx, () => summarizeEntries(provider, entries, context));
    expect(summary.trim().length).toBeGreaterThan(0);

    const notes = await callProvider(ctx, () => generateReleaseNotes(provider, entries, context));
    expect(notes.trim().length).toBeGreaterThan(0);
  }, 240_000);
});
