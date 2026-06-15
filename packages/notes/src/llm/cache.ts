import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { CompleteOptions } from '../core/types.js';
import type { CompleteResult, LLMMessage, LLMProvider } from './provider.js';

/** On-disk cache location, under the OS temp dir — same convention as the few-shot examples fetcher. */
function defaultCacheDir(): string {
  return path.join(os.tmpdir(), 'releasekit', 'llm-cache');
}

/** Deterministic JSON: recursively sort object keys so equivalent inputs hash to the same key. */
function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, val) =>
    val && typeof val === 'object' && !Array.isArray(val)
      ? Object.fromEntries(Object.entries(val as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)))
      : val,
  );
}

/**
 * Wrap a provider so identical completions are served from an on-disk cache. The key covers
 * everything that determines the output — provider, model, the full message array, temperature and
 * maxTokens, and any structured-output schema/tool — so a changed input misses cleanly. Lets a
 * dry-run → `--apply` backfill (or a retried run) reuse prior generations instead of paying the LLM
 * again. Best-effort: any read/parse/write failure falls back to a live call.
 */
export function withContentHashCache(
  provider: LLMProvider,
  model: string,
  dir: string = defaultCacheDir(),
): LLMProvider {
  return {
    name: provider.name,
    capabilities: provider.capabilities,
    async complete(messages: LLMMessage[], options?: CompleteOptions): Promise<CompleteResult> {
      const key = createHash('sha256')
        .update(
          stableStringify({
            provider: provider.name,
            model,
            messages,
            temperature: options?.temperature,
            maxTokens: options?.maxTokens,
            schema: options?.schema,
            toolName: options?.toolName,
          }),
        )
        .digest('hex');
      const file = path.join(dir, `${key}.json`);

      try {
        return JSON.parse(fs.readFileSync(file, 'utf-8')) as CompleteResult;
      } catch {
        // Cache miss or unreadable entry — fall through to a live call.
      }

      const result = await provider.complete(messages, options);
      try {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(file, JSON.stringify(result));
      } catch {
        // Caching is best-effort; a write failure must not fail the run.
      }
      return result;
    },
  };
}
