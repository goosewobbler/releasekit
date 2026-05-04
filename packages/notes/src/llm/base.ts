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
    return options?.timeout ?? LLM_DEFAULTS.timeout;
  }

  protected getMaxTokens(options?: CompleteOptions): number {
    return options?.maxTokens ?? LLM_DEFAULTS.maxTokens;
  }

  protected getTemperature(options?: CompleteOptions): number {
    return options?.temperature ?? LLM_DEFAULTS.temperature;
  }
}
