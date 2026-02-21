import type { CompleteOptions } from '../core/types.js';
import { LLM_DEFAULTS } from './defaults.js';
import type { LLMProvider } from './provider.js';

export type { LLMProvider };

export abstract class BaseLLMProvider implements LLMProvider {
  abstract readonly name: string;

  abstract complete(prompt: string, options?: CompleteOptions): Promise<string>;

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
