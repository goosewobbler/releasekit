import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { CompleteOptions } from '../core/types.js';
import type { CompleteResult, LLMMessage, LLMProvider } from './provider.js';

function defaultCacheDir(): string {
  return path.join(os.tmpdir(), 'releasekit', 'llm-cache');
}

function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, val) =>
    val && typeof val === 'object' && !Array.isArray(val)
      ? Object.fromEntries(Object.entries(val as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)))
      : val,
  );
}

export interface CacheIdentity {
  model: string;
  /** Two servers with the same model name and prompt would otherwise collide and serve each other's responses. */
  baseURL?: string;
}

/**
 * Lets a dry-run → `--apply` backfill (or a retried run) reuse prior generations instead of paying the LLM
 * again.
 */
export function withContentHashCache(
  provider: LLMProvider,
  identity: CacheIdentity,
  dir: string = defaultCacheDir(),
  { refresh = false }: { refresh?: boolean } = {},
): LLMProvider {
  return {
    name: provider.name,
    capabilities: provider.capabilities,
    async complete(messages: LLMMessage[], options?: CompleteOptions): Promise<CompleteResult> {
      // Keying on a temperature the provider ignores (Anthropic) would bust an otherwise-identical cached
      // response whenever the ignored value changes.
      const temperature = provider.capabilities.honorsTemperature === false ? undefined : options?.temperature;
      const key = createHash('sha256')
        .update(
          stableStringify({
            provider: provider.name,
            model: identity.model,
            baseURL: identity.baseURL,
            messages,
            temperature,
            maxTokens: options?.maxTokens,
            schema: options?.schema,
            toolName: options?.toolName,
          }),
        )
        .digest('hex');
      const file = path.join(dir, `${key}.json`);

      if (!refresh) {
        try {
          return JSON.parse(await fs.readFile(file, 'utf-8')) as CompleteResult;
        } catch {
          // Cache miss or unreadable entry - fall through to a live call.
        }
      }

      const result = await provider.complete(messages, options);
      try {
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(file, JSON.stringify(result));
      } catch {
        // Caching is best-effort; a write failure must not fail the run.
      }
      return result;
    },
  };
}
