import type { CompleteOptions } from '../core/types.js';
import { LLMError } from '../errors/index.js';
import { LLM_DEFAULTS } from './defaults.js';
import type { CompleteResult, LLMMessage } from './messages.js';
import type { LLMProvider, ProviderCapabilities } from './provider.js';
import { isRetryableProviderError } from './retryable.js';

export type { LLMProvider };

export interface IdleTimeout {
  readonly signal: AbortSignal;
  reset(): void;
}

export abstract class BaseLLMProvider implements LLMProvider {
  abstract readonly name: string;
  abstract readonly capabilities: ProviderCapabilities;

  abstract complete(messages: LLMMessage[], options?: CompleteOptions): Promise<CompleteResult>;

  protected getTimeout(options?: CompleteOptions): number {
    const timeout = options?.timeout ?? LLM_DEFAULTS.timeout;
    // setTimeout runs any delay outside [1, 2^31-1] after 1ms, which would abort every call.
    const MAX_TIMEOUT_MS = 2_147_483_647;
    if (!Number.isFinite(timeout) || timeout < 1) {
      return LLM_DEFAULTS.timeout;
    }
    return Math.min(Math.trunc(timeout), MAX_TIMEOUT_MS);
  }

  protected async withIdleTimeout<T>(
    label: string,
    options: CompleteOptions | undefined,
    request: (idle: IdleTimeout) => Promise<T>,
  ): Promise<T> {
    const ms = this.getTimeout(options);
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new DOMException(`Nothing received for ${ms}ms`, 'TimeoutError')),
      ms,
    );
    try {
      return await request({ signal: controller.signal, reset: () => timer.refresh() });
    } catch (error) {
      // An abort is a timeout whatever `request` then threw, because each SDK surfaces an aborted stream
      // differently.
      if (controller.signal.aborted) {
        throw new LLMError(`${label} request timed out: nothing received for ${ms}ms`, {
          cause: controller.signal.reason,
          retryable: true,
        });
      }
      if (error instanceof LLMError) {
        throw error;
      }
      throw new LLMError(`${label} error: ${error instanceof Error ? error.message : String(error)}`, {
        cause: error,
        retryable: isRetryableProviderError(error),
      });
    } finally {
      clearTimeout(timer);
    }
  }

  protected getMaxTokens(options?: CompleteOptions): number {
    return options?.maxTokens ?? LLM_DEFAULTS.maxTokens;
  }

  protected getTemperature(options?: CompleteOptions): number {
    return options?.temperature ?? LLM_DEFAULTS.temperature;
  }
}
