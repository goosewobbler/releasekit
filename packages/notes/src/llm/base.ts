import type { CompleteOptions } from '../core/types.js';
import { LLM_DEFAULTS } from './defaults.js';
import type { CompleteResult, LLMMessage } from './messages.js';
import type { LLMProvider, ProviderCapabilities } from './provider.js';

export type { LLMProvider };

export abstract class BaseLLMProvider implements LLMProvider {
  abstract readonly name: string;
  abstract readonly capabilities: ProviderCapabilities;

  abstract complete(messages: LLMMessage[], options?: CompleteOptions): Promise<CompleteResult>;

  protected getTimeout(options?: CompleteOptions): number {
    const timeout = options?.timeout ?? LLM_DEFAULTS.timeout;
    // Guard the value passed to `AbortSignal.timeout()`, which runs while building the signal —
    // *before* the provider's try block, so a bad value would throw past the best-effort fallback.
    //   - 0 / negative / non-finite → use the default (0 would abort every call before a request).
    //   - above the timer ceiling (2^31-1 ms ≈ 24.8 days) → clamp, not throw/overflow. A huge value
    //     means "effectively no timeout", so clamping preserves intent rather than dropping to 60s.
    const MAX_TIMEOUT_MS = 2_147_483_647;
    if (!Number.isFinite(timeout) || timeout <= 0) return LLM_DEFAULTS.timeout;
    return Math.min(timeout, MAX_TIMEOUT_MS);
  }

  /**
   * An AbortSignal that fires after the configured request timeout. Pass it to the provider's
   * request (SDK `{ signal }` request option, or fetch's `signal`). When it fires the request
   * aborts; providers check `signal.aborted` in their catch to surface a clear timeout error.
   */
  protected timeoutSignal(options?: CompleteOptions): AbortSignal {
    return AbortSignal.timeout(this.getTimeout(options));
  }

  protected getMaxTokens(options?: CompleteOptions): number {
    return options?.maxTokens ?? LLM_DEFAULTS.maxTokens;
  }

  protected getTemperature(options?: CompleteOptions): number {
    return options?.temperature ?? LLM_DEFAULTS.temperature;
  }
}
