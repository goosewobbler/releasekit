import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ChangelogEntry } from '../../src/core/types.js';
import { type CacheIdentity, withContentHashCache } from '../../src/llm/cache.js';
import type { ReleaseNotesContext } from '../../src/llm/index.js';
import type { CompleteResult, LLMMessage, LLMProvider, ProviderCapabilities } from '../../src/llm/provider.js';

/**
 * Eval harness for the LLM-notes pipeline. Golden commit sets run through the real pipeline against
 * recorded provider responses, replayed deterministically in CI via the on-disk cache format
 * ({@link withContentHashCache}) - no API keys needed. A changed prompt busts the cache key, so a
 * missing fixture is itself the signal to re-record.
 *
 * Modes (env):
 *   default              strict replay from the committed cache; a cache miss fails loudly.
 *   RELEASEKIT_EVAL_RECORD=1   seed the cache from the human-readable `*.recorded.md` fixtures (no model).
 *   RELEASEKIT_EVAL=1          run a real provider (Ollama), recording fresh responses into the cache
 *                              and back into `*.recorded.md`.
 *
 * The recording modes rewrite the entries the cases they run produce, and nothing else - changing
 * a prompt therefore leaves the old entry behind under its now-unreachable key. To re-record from a
 * clean slate, delete the fixture cache first:
 *
 *   rm -rf packages/notes/test/eval/fixtures/cache
 *   RELEASEKIT_EVAL_RECORD=1 pnpm --filter @releasekit/notes test
 */

export const EVAL_DIR = fileURLToPath(new URL('.', import.meta.url));
export const CACHE_DIR = fileURLToPath(new URL('./fixtures/cache', import.meta.url));

// Fixed across record and replay: the cache key folds in provider name & identity, so both must be
// stable regardless of which underlying model produced a response.
const EVAL_PROVIDER_NAME = 'eval';
export const EVAL_IDENTITY: CacheIdentity = { model: 'eval-fixture' };

/**
 * Every mode reports these, the real provider included. A task consults them to decide whether to send a
 * structured-output `schema`/`toolName`, and both are part of the cache key, so letting Ollama's
 * `structuredOutputs: true` through would mean a live recording could never be found by replay.
 */
export const CAPABILITIES: ProviderCapabilities = { systemRole: true, structuredOutputs: false, toolUse: false };

export const isLiveMode = process.env.RELEASEKIT_EVAL === '1' || process.env.RELEASEKIT_EVAL === 'true';
export const isRecordMode = process.env.RELEASEKIT_EVAL_RECORD === '1' || process.env.RELEASEKIT_EVAL_RECORD === 'true';

/**
 * Offline modes can't answer a corrective retry: replay has no entry, and re-seeding the same canned
 * response would cache it and fail later on a misleading assertion.
 */
function refuseCorrectiveRetry(messages: LLMMessage[]): void {
  if (messages.some((m) => m.role === 'assistant')) {
    throw new Error(
      'eval: the task rejected the recorded response and asked for a correction. Fix the *.recorded.md ' +
        'response (or the validator), then re-seed with RELEASEKIT_EVAL_RECORD=1.',
    );
  }
}

const strictOfflineProvider: LLMProvider = {
  name: EVAL_PROVIDER_NAME,
  capabilities: CAPABILITIES,
  async complete(messages: LLMMessage[]): Promise<CompleteResult> {
    refuseCorrectiveRetry(messages);
    throw new Error(
      'eval replay: no recorded fixture for this request. The prompt or golden input changed — ' +
        're-record with RELEASEKIT_EVAL_RECORD=1 (from *.recorded.md) or RELEASEKIT_EVAL=1 (live provider).',
    );
  },
};

function cannedProvider(content: string): LLMProvider {
  return {
    name: EVAL_PROVIDER_NAME,
    capabilities: CAPABILITIES,
    async complete(messages: LLMMessage[]): Promise<CompleteResult> {
      refuseCorrectiveRetry(messages);
      return { content };
    },
  };
}

/**
 * Tees each response back into `*.recorded.md` so the human-readable fixture and the cache entry stay
 * the same generation.
 */
export function asEvalProvider(base: LLMProvider, caseName: string, provenance: string): LLMProvider {
  return {
    name: EVAL_PROVIDER_NAME,
    capabilities: CAPABILITIES,
    async complete(messages: LLMMessage[], options): Promise<CompleteResult> {
      const result = await base.complete(messages, options);
      writeRecorded(caseName, result.content, provenance);
      return result;
    },
  };
}

export interface GoldenCase<TContext = ReleaseNotesContext> {
  entries: ChangelogEntry[];
  context: TContext;
}

/** Golden fixtures carry a fixed date so cache keys are stable. */
export function loadGoldenCase<TContext = ReleaseNotesContext>(name: string): GoldenCase<TContext> {
  const path = fileURLToPath(new URL(`./fixtures/${name}.json`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf-8')) as GoldenCase<TContext>;
}

function recordedPath(name: string): string {
  return fileURLToPath(new URL(`./fixtures/${name}.recorded.md`, import.meta.url));
}

// The assertions' calibration (length bounds, tense ratio) is implicitly tuned to whatever produced the
// fixture, and the cache key pins the model to EVAL_IDENTITY, so this header is the only record of what
// actually generated it.
const PROVENANCE_HEADER = /^<!--\s*recorded:.*?-->\n+/;

function loadRecorded(name: string): string {
  return readFileSync(recordedPath(name), 'utf-8').replace(PROVENANCE_HEADER, '').trimEnd();
}

function writeRecorded(name: string, content: string, provenance: string): void {
  writeFileSync(recordedPath(name), `<!-- recorded: ${provenance} -->\n\n${content.trimEnd()}\n`);
}

export async function evalProvider(caseName: string): Promise<LLMProvider> {
  if (isLiveMode) {
    const { OllamaProvider } = await import('../../src/llm/ollama.js');
    const model = process.env.RELEASEKIT_EVAL_MODEL ?? 'llama3.2';
    const baseURL = process.env.OLLAMA_BASE_URL;
    const live = asEvalProvider(new OllamaProvider({ model, baseURL }), caseName, `ollama/${model}`);
    return withContentHashCache(live, EVAL_IDENTITY, CACHE_DIR, { refresh: true });
  }
  if (isRecordMode) {
    return withContentHashCache(cannedProvider(loadRecorded(caseName)), EVAL_IDENTITY, CACHE_DIR, { refresh: true });
  }
  return withContentHashCache(strictOfflineProvider, EVAL_IDENTITY, CACHE_DIR);
}
