import { readFileSync, writeFileSync } from 'node:fs';
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
 *   RELEASEKIT_EVAL=1          run a real provider (Ollama), recording fresh responses into the cache
 *                              and back into `*.recorded.md`.
 *
 * The recording modes pass `refresh` so the cache writes through instead of serving the entry it is
 * meant to replace. They rewrite the entries the cases they run produce, and nothing else — changing
 * a prompt therefore leaves the old entry behind under its now-unreachable key. To re-record from a
 * clean slate, delete the fixture cache first:
 *
 *   rm -rf packages/notes/test/eval/fixtures/cache
 *   RELEASEKIT_EVAL_RECORD=1 pnpm --filter @releasekit/notes test
 */

export const EVAL_DIR = fileURLToPath(new URL('.', import.meta.url));
export const CACHE_DIR = fileURLToPath(new URL('./fixtures/cache', import.meta.url));

// Fixed across record and replay: the cache key folds in provider name + identity, so both must be
// stable regardless of which underlying model (canned, offline, or a real Ollama) produced a response.
const EVAL_PROVIDER_NAME = 'eval';
export const EVAL_IDENTITY: CacheIdentity = { model: 'eval-fixture' };

/**
 * Every mode reports these, the real provider included — capabilities are not free-floating metadata.
 * A task consults them to decide whether to send a structured-output `schema`/`toolName`, and both are
 * part of the cache key, so a provider that advertises different capabilities keys the same golden
 * input differently. Ollama advertises `structuredOutputs: true`; letting that through would mean a
 * live recording of a structured case could never be found by the replay that has to read it back.
 */
export const CAPABILITIES: ProviderCapabilities = { systemRole: true, structuredOutputs: false, toolUse: false };

export const isLiveMode = process.env.RELEASEKIT_EVAL === '1' || process.env.RELEASEKIT_EVAL === 'true';
export const isRecordMode = process.env.RELEASEKIT_EVAL_RECORD === '1' || process.env.RELEASEKIT_EVAL_RECORD === 'true';

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

/**
 * Re-brand a real provider under the fixed eval name and capabilities so its recorded responses key
 * like the rest, and tee each response back into `*.recorded.md` so the human-readable fixture and
 * the cache entry stay the same generation — with the model that produced it recorded alongside.
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

export interface GoldenCase {
  entries: ChangelogEntry[];
  context: ReleaseNotesContext;
}

/** Load a golden input fixture (a real-shaped commit set with a fixed date, so cache keys are stable). */
export function loadGoldenCase(name: string): GoldenCase {
  const path = fileURLToPath(new URL(`./fixtures/${name}.json`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf-8')) as GoldenCase;
}

function recordedPath(name: string): string {
  return fileURLToPath(new URL(`./fixtures/${name}.recorded.md`, import.meta.url));
}

// Provenance header stamped on a recording. The assertions' calibration (length bounds, tense ratio)
// is implicitly tuned to whatever produced the fixture, and the cache key deliberately pins the model
// to EVAL_IDENTITY so replay works — which leaves nothing else recording what actually generated it.
const PROVENANCE_HEADER = /^<!--\s*recorded:.*?-->\n+/;

function loadRecorded(name: string): string {
  return readFileSync(recordedPath(name), 'utf-8').replace(PROVENANCE_HEADER, '').trimEnd();
}

function writeRecorded(name: string, content: string, provenance: string): void {
  writeFileSync(recordedPath(name), `<!-- recorded: ${provenance} -->\n\n${content.trimEnd()}\n`);
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
    const live = asEvalProvider(new OllamaProvider({ model, baseURL }), caseName, `ollama/${model}`);
    return withContentHashCache(live, EVAL_IDENTITY, CACHE_DIR, { refresh: true });
  }
  if (isRecordMode) {
    return withContentHashCache(cannedProvider(loadRecorded(caseName)), EVAL_IDENTITY, CACHE_DIR, { refresh: true });
  }
  return withContentHashCache(strictOfflineProvider, EVAL_IDENTITY, CACHE_DIR);
}
