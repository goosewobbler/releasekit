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
 * Assertions check structure, not wording. Each chunk must also have at least one rewritten entry:
 * the fallback keeps entries verbatim, so counts alone would pass with no model at all. The model
 * must therefore handle the structured-output schema.
 *
 * A proven provider outage skips with a `::warning::` annotation, so a hosted model's uptime doesn't
 * gate merges; anything else fails. See {@link isProviderUnreachable}.
 */
const E2E_ENABLED = process.env.RELEASEKIT_NOTES_E2E === '1' || process.env.RELEASEKIT_NOTES_E2E === 'true';
const MODEL = process.env.RELEASEKIT_NOTES_E2E_MODEL ?? 'llama3.2';
const context = { packageName: 'my-lib', version: '2.0.0', previousVersion: '1.0.0' };

// One full chunk plus part of a second, tracking the production chunk size.
const CHUNK_SIZE = LLM_DEFAULTS.enhanceCategorizeChunkSize;
const ENTRY_COUNT = CHUNK_SIZE + 5;

// A hung host costs each call ~140s (3 attempts × 45s + backoff), so ~280s for the two sequential
// chunks. The test timeout leaves room to classify that as an outage and skip.
const CALL_TIMEOUT_MS = 45_000;
const TEST_TIMEOUT_MS = 330_000;

/** Formats an error with its cause chain; `fetch failed` alone doesn't say what failed. */
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
  const reason = `provider unreachable — ${errors.map(describeError).join('; ')}`;
  // Annotate the run so a skip doesn't look like a pass. The leading newline keeps vitest's colour
  // codes off the start of the line, where they'd stop Actions parsing the command.
  console.log(`\n::warning title=notes LLM e2e skipped::${reason}`);
  return ctx.skip(reason);
}

/**
 * Runs a free-text task, skipping on a proven outage. These tasks have no fallback, so provider errors
 * throw. Assertions stay with the caller, so bad output is never mistaken for an outage.
 */
async function callProvider<T>(ctx: TestContext, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (isProviderUnreachable(error)) {
      skipUnreachable(ctx, [error]);
    }
    throw error;
  }
}

describe.skipIf(!E2E_ENABLED)('notes LLM e2e (real Ollama)', () => {
  beforeAll(() => {
    // Without it the provider dials localhost, which CI refuses, so every run would skip as an outage.
    if (process.env.CI && !process.env.OLLAMA_BASE_URL) {
      throw new Error('OLLAMA_BASE_URL must be set when RELEASEKIT_NOTES_E2E runs under CI');
    }
  });

  const ollama = new OllamaProvider({ model: MODEL });

  // Errors that survived retries, reset per test. enhanceAndCategorize falls back instead of throwing,
  // so this is the only record of why a chunk came back unchanged.
  let failures: unknown[] = [];

  // Retry as the pipeline does (src/core/pipeline.ts), so one transient error doesn't cause a fallback.
  const provider: LLMProvider = {
    name: ollama.name,
    capabilities: ollama.capabilities,
    async complete(messages, options) {
      try {
        return await withRetry(() => ollama.complete(messages, { ...options, timeout: CALL_TIMEOUT_MS }), {
          ...LLM_DEFAULTS.retry,
          shouldRetry: isRetryableLLMError,
        });
      } catch (error) {
        failures.push(error);
        throw error;
      }
    },
  };

  beforeEach(() => {
    failures = [];
  });

  it(
    'should enhance and categorize a large release across chunk boundaries',
    async (ctx) => {
      // Two structured calls, then a category merge.
      const entries: ChangelogEntry[] = Array.from({ length: ENTRY_COUNT }, (_, i) => ({
        type: i % 2 === 0 ? 'fixed' : 'added',
        description: `${i % 2 === 0 ? 'Fix' : 'Add'} behaviour ${i} in the widget subsystem`,
      }));

      const result = await enhanceAndCategorize(provider, entries, context);

      // Counted per chunk: chunks fall back independently, so a good first chunk could hide a failed second.
      const rewrittenIn = (from: number, to: number) =>
        result.enhancedEntries.slice(from, to).filter((e, i) => e.description !== entries[from + i]?.description)
          .length;
      const firstChunk = rewrittenIn(0, CHUNK_SIZE);
      const lastChunk = rewrittenIn(CHUNK_SIZE, entries.length);

      // An unchanged chunk is an outage only if every recorded error proves it. The skip covers the whole
      // test, so a real failure in one chunk can hide behind an outage in the other until the next run.
      if ((firstChunk === 0 || lastChunk === 0) && failures.length > 0 && failures.every(isProviderUnreachable)) {
        skipUnreachable(ctx, failures);
      }
      const why =
        failures.length > 0
          ? `provider errors: ${failures.map(describeError).join('; ')}`
          : 'no provider error, so its output failed validation or came back verbatim (see the warnings above)';
      expect(firstChunk, `chunk 1 (entries 1-${CHUNK_SIZE}) came back unrewritten; ${why}`).toBeGreaterThan(0);
      expect(
        lastChunk,
        `chunk 2 (entries ${CHUNK_SIZE + 1}-${ENTRY_COUNT}) came back unrewritten; ${why}`,
      ).toBeGreaterThan(0);
      // Every entry comes back once, non-empty, and categorized.
      expect(result.enhancedEntries).toHaveLength(ENTRY_COUNT);
      expect(result.enhancedEntries.every((e) => typeof e.description === 'string' && e.description.length > 0)).toBe(
        true,
      );
      expect(result.categories.length).toBeGreaterThan(0);
      const categorized = result.categories.reduce((total, c) => total + c.entries.length, 0);
      expect(categorized).toBe(ENTRY_COUNT);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'should produce a prose summary and release notes via the text path',
    async (ctx) => {
      const entries: ChangelogEntry[] = [
        { type: 'added', description: 'Add deeplink support for the mobile client' },
        { type: 'fixed', description: 'Fix a crash when the config file is missing' },
      ];

      const summary = await callProvider(ctx, () => summarizeEntries(provider, entries, context));
      expect(summary.trim().length).toBeGreaterThan(0);

      const notes = await callProvider(ctx, () => generateReleaseNotes(provider, entries, context));
      expect(notes.trim().length).toBeGreaterThan(0);
    },
    TEST_TIMEOUT_MS,
  );
});
