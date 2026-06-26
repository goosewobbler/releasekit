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
    // Guard against a 0 / negative / non-finite timeout: `AbortSignal.timeout(0)` aborts every call
    // before a request is sent, and a negative/non-finite value throws *before* the provider's try
    // block (bypassing the best-effort fallback). Fall back to the default in those cases.
    return Number.isFinite(timeout) && timeout > 0 ? timeout : LLM_DEFAULTS.timeout;
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
