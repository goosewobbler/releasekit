import { beforeAll, beforeEach, describe, expect, it, type TestContext } from 'vitest';
import type { ChangelogEntry } from '../../src/core/types.js';
import { LLMError } from '../../src/errors/index.js';
import { LLM_DEFAULTS } from '../../src/llm/defaults.js';
import { OllamaProvider } from '../../src/llm/ollama.js';
import type { LLMProvider } from '../../src/llm/provider.js';
import { isRetryableLLMError } from '../../src/llm/retryable.js';
import { enhanceAndCategorize } from '../../src/llm/tasks/enhance-and-categorize.js';
import { generateReleaseNotes } from '../../src/llm/tasks/release-notes.js';
import { summarizeEntries } from '../../src/llm/tasks/summarize.js';
import { withRetry } from '../../src/utils/retry.js';

/**
 * Opt-in test of the LLM notes pipeline against a live Ollama server: chunking (two structured calls
 * and a merge) and the free-text tasks. Skipped unless enabled:
 *   RELEASEKIT_NOTES_LIVE=1 [RELEASEKIT_NOTES_LIVE_MODEL=llama3.2] [OLLAMA_BASE_URL=http://localhost:11434] \
 *     pnpm --filter @releasekit/notes test
 *
 * Assertions check structure, not wording, and the model must handle the structured-output schema.
 * An Ollama outage skips with a warning annotation instead of failing; see {@link isOllamaUnreachable}.
 */
const LIVE_ENABLED = process.env.RELEASEKIT_NOTES_LIVE === '1' || process.env.RELEASEKIT_NOTES_LIVE === 'true';
const MODEL = process.env.RELEASEKIT_NOTES_LIVE_MODEL ?? 'llama3.2';
const context = { packageName: 'my-lib', version: '2.0.0', previousVersion: '1.0.0' };

const CHUNK_SIZE = LLM_DEFAULTS.enhanceCategorizeChunkSize;
const ENTRY_COUNT = CHUNK_SIZE + 5;

// Room for both chunks to exhaust their retries on a hung host (~140s each) and still skip.
const CALL_TIMEOUT_MS = 45_000;
const TEST_TIMEOUT_MS = 330_000;

// NETWORK_ERROR_CODES from src/llm/retryable.ts, plus undici's.
const TRANSPORT_ERROR_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ECONNABORTED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE',
  'ENETUNREACH',
  'ENETDOWN',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
]);

function isTransportFailure(error: object): boolean {
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && TRANSPORT_ERROR_CODES.has(code);
}

/**
 * Whether a failure proves Ollama was unreachable, so the live test skips instead of failing. Proof is a
 * `retryable: true` LLMError with either no cause (the Ollama provider classified it) or a socket error
 * code in its cause chain. `retryable` alone isn't enough: the provider flags any unknown error retryable.
 *
 * Known gap: a 5xx that Ollama returns for a bad request, or a prompt that times out, skips.
 */
function isOllamaUnreachable(error: unknown): boolean {
  if (!(error instanceof LLMError) || error.retryable !== true) {
    return false;
  }
  if (error.cause === undefined) {
    return true;
  }
  let cause: unknown = error.cause;
  while (cause !== null && typeof cause === 'object') {
    if (isTransportFailure(cause)) {
      return true;
    }
    cause = (cause as { cause?: unknown }).cause;
  }
  return false;
}

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
  // The leading newline keeps vitest's colour codes off the line, or Actions won't parse the annotation.
  console.log(`\n::warning title=notes LLM live test skipped::${reason}`);
  return ctx.skip(reason);
}

async function callProvider<T>(ctx: TestContext, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (isOllamaUnreachable(error)) {
      skipUnreachable(ctx, [error]);
    }
    throw error;
  }
}

// Outside the opt-in suite on purpose: this decides whether the live test can fail at all.
describe('isOllamaUnreachable', () => {
  it('should treat a provider-classified transient failure as infra', () => {
    expect(isOllamaUnreachable(new LLMError('Ollama request timed out after 120000ms', { retryable: true }))).toBe(
      true,
    );
  });

  it('should treat a non-retryable request failure as our bug', () => {
    expect(isOllamaUnreachable(new LLMError('Ollama request failed: 400', { retryable: false }))).toBe(false);
  });

  it('should treat an unclassified LLMError as our bug', () => {
    expect(isOllamaUnreachable(new LLMError('Empty response from Ollama'))).toBe(false);
  });

  it("should treat a connection refused under undici's fetch failure as infra", () => {
    const socket = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:11434'), { code: 'ECONNREFUSED' });
    const fetchFailed = new TypeError('fetch failed', { cause: socket });
    expect(
      isOllamaUnreachable(new LLMError('Ollama error: fetch failed', { cause: fetchFailed, retryable: true })),
    ).toBe(true);
  });

  it('should not trust the retryable flag when the cause is a bug in our code', () => {
    const bug = new TypeError("Cannot read properties of null (reading 'message')");
    expect(isOllamaUnreachable(new LLMError(`Ollama error: ${bug.message}`, { cause: bug, retryable: true }))).toBe(
      false,
    );
  });

  it('should not trust the retryable flag when the cause is an unparseable response', () => {
    const parse = new SyntaxError('Unexpected token \'<\', "<html><bod"... is not valid JSON');
    expect(isOllamaUnreachable(new LLMError(`Ollama error: ${parse.message}`, { cause: parse, retryable: true }))).toBe(
      false,
    );
  });

  it('should never classify a non-LLM failure as infra', () => {
    expect(isOllamaUnreachable(new Error('expected 35 entries, got 34'))).toBe(false);
    expect(isOllamaUnreachable(new TypeError('x.map is not a function'))).toBe(false);
    expect(isOllamaUnreachable('a string')).toBe(false);
    expect(isOllamaUnreachable(undefined)).toBe(false);
  });
});

describe.skipIf(!LIVE_ENABLED)('notes LLM against live Ollama', () => {
  beforeAll(() => {
    // Otherwise CI dials localhost and every run skips as an outage.
    if (process.env.CI && !process.env.OLLAMA_BASE_URL) {
      throw new Error('OLLAMA_BASE_URL must be set when RELEASEKIT_NOTES_LIVE runs under CI');
    }
  });

  const ollama = new OllamaProvider({ model: MODEL });

  // enhanceAndCategorize swallows provider errors, so record them to tell an outage from a regression.
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

      // Known gap: an outage in one chunk also skips a real failure in the other.
      if ((firstChunk === 0 || lastChunk === 0) && failures.length > 0 && failures.every(isOllamaUnreachable)) {
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
