import { readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ChangelogEntry } from '../../src/core/types.js';
import { type CacheIdentity, withContentHashCache } from '../../src/llm/cache.js';
import type { ReleaseNotesContext } from '../../src/llm/index.js';
import type { CompleteResult, LLMMessage, LLMProvider, ProviderCapabilities } from '../../src/llm/provider.js';

/**
 * Eval harness for the LLM-notes pipeline. Golden commit sets run through the real pipeline against
 * recorded provider responses, replayed deterministically in CI via the existing on-disk cache format
 * ({@link withContentHashCache}) — no API keys needed. The value is in the deterministic assertions:
 * a prompt or post-processing regression changes the output, and a changed prompt busts the cache key,
 * so a missing fixture is itself the signal to re-record.
 *
 * Modes (env):
 *   default              strict replay from the committed cache; a cache miss fails loudly.
 *   RELEASEKIT_EVAL_RECORD=1   seed the cache from the human-readable `*.recorded.md` fixtures (no model).
 *   RELEASEKIT_EVAL=1          run a real provider (Ollama), recording fresh responses into the cache.
 */

export const EVAL_DIR = fileURLToPath(new URL('.', import.meta.url));
export const CACHE_DIR = fileURLToPath(new URL('./fixtures/cache', import.meta.url));

// Fixed across record and replay: the cache key folds in provider name + identity, so both must be
// stable regardless of which underlying model (canned, offline, or a real Ollama) produced a response.
const EVAL_PROVIDER_NAME = 'eval';
export const EVAL_IDENTITY: CacheIdentity = { model: 'eval-fixture' };

const CAPABILITIES: ProviderCapabilities = { systemRole: true, structuredOutputs: false, toolUse: false };

export const isLiveMode = process.env.RELEASEKIT_EVAL === '1' || process.env.RELEASEKIT_EVAL === 'true';
export const isRecordMode = process.env.RELEASEKIT_EVAL_RECORD === '1' || process.env.RELEASEKIT_EVAL_RECORD === 'true';

// Record and live modes regenerate fixtures, but withContentHashCache is read-first — it would serve
// an existing entry before ever calling the canned/real provider, so an edited recording or a live
// re-run could never replace a stale fixture. Clear the cache once up front so these modes always
// re-record from scratch. Replay (default) never clears: it reads the committed fixtures.
if (isRecordMode || isLiveMode) {
  rmSync(CACHE_DIR, { recursive: true, force: true });
}

const strictOfflineProvider: LLMProvider = {
  name: EVAL_PROVIDER_NAME,
  capabilities: CAPABILITIES,
  async complete(): Promise<CompleteResult> {
    throw new Error(
      'eval replay: no recorded fixture for this request. The prompt or golden input changed — ' +
        're-record with RELEASEKIT_EVAL_RECORD=1 (from *.recorded.md) or RELEASEKIT_EVAL=1 (live provider).',
    );
  },
};

/** Base provider that returns a fixed canned response, used to seed fixtures from `*.recorded.md`. */
function cannedProvider(content: string): LLMProvider {
  return {
    name: EVAL_PROVIDER_NAME,
    capabilities: CAPABILITIES,
    async complete(): Promise<CompleteResult> {
      return { content };
    },
  };
}

/** Re-brand a real provider under the fixed eval name so its recorded responses key like the rest. */
function asEvalProvider(base: LLMProvider): LLMProvider {
  return {
    name: EVAL_PROVIDER_NAME,
    capabilities: base.capabilities,
    complete: (messages: LLMMessage[], options) => base.complete(messages, options),
  };
}

export interface GoldenCase {
  entries: ChangelogEntry[];
  context: ReleaseNotesContext;
}

/** Load a golden input fixture (a real-shaped commit set with a fixed date, so cache keys are stable). */
export function loadGoldenCase(name: string): GoldenCase {
  const path = fileURLToPath(new URL(`./fixtures/${name}.json`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf-8')) as GoldenCase;
}

function loadRecorded(name: string): string {
  const path = fileURLToPath(new URL(`./fixtures/${name}.recorded.md`, import.meta.url));
  return readFileSync(path, 'utf-8').trimEnd();
}

/**
 * The provider each eval case runs through. Live mode wraps a real Ollama provider (recording as it
 * goes); record mode seeds from the committed markdown; default mode replays strictly from the cache.
 * Every mode wraps {@link withContentHashCache} so the on-disk format is identical across them.
 */
export async function evalProvider(caseName: string): Promise<LLMProvider> {
  if (isLiveMode) {
    const { OllamaProvider } = await import('../../src/llm/ollama.js');
    const model = process.env.RELEASEKIT_EVAL_MODEL ?? 'llama3.2';
    const baseURL = process.env.OLLAMA_BASE_URL;
    return withContentHashCache(asEvalProvider(new OllamaProvider({ model, baseURL })), EVAL_IDENTITY, CACHE_DIR);
  }
  if (isRecordMode) {
    return withContentHashCache(cannedProvider(loadRecorded(caseName)), EVAL_IDENTITY, CACHE_DIR);
  }
  return withContentHashCache(strictOfflineProvider, EVAL_IDENTITY, CACHE_DIR);
}
