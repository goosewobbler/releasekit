import OpenAI from 'openai';
import type { CompleteOptions } from '../core/types.js';
import { LLMError } from '../errors/index.js';
import { BaseLLMProvider } from './base.js';
import type { CompleteResult, LLMMessage } from './messages.js';
import { debugLogMessages } from './messages.js';
import type { ProviderCapabilities } from './provider.js';
import { isRetryableProviderError } from './retryable.js';

export interface OpenAICompatibleConfig {
  apiKey?: string;
  baseURL: string;
  model: string;
}

export class OpenAICompatibleProvider extends BaseLLMProvider {
  readonly name = 'openai-compatible';
  readonly capabilities: ProviderCapabilities = {
    systemRole: true,
    structuredOutputs: false,
    toolUse: false,
    honorsTemperature: true,
  };

  private client: OpenAI;
  private model: string;

  constructor(config: OpenAICompatibleConfig) {
    super();

    const apiKey = config.apiKey ?? process.env.OPENAI_API_KEY ?? 'dummy';

    this.client = new OpenAI({
      apiKey,
      baseURL: config.baseURL,
    });

    this.model = config.model;
  }

  async complete(messages: LLMMessage[], options?: CompleteOptions): Promise<CompleteResult> {
    debugLogMessages(this.name, messages);

    const signal = this.timeoutSignal(options);
    try {
      const openaiMessages = messages.map((m) => ({ role: m.role, content: m.content }));

      const requestParams = {
        model: this.model,
        messages: openaiMessages,
        max_tokens: this.getMaxTokens(options),
        temperature: this.getTemperature(options),
        stream: false as const,
      };

      const response = await this.client.chat.completions.create(requestParams, { signal });

      const content = response.choices[0]?.message?.content;

      if (!content) {
        throw new LLMError('Empty response from LLM');
      }

      return { content };
    } catch (error) {
      if (error instanceof LLMError) throw error;
      if (signal.aborted) {
        throw new LLMError(`${this.name} request timed out after ${this.getTimeout(options)}ms`, { retryable: true });
      }
      throw new LLMError(`LLM API error: ${error instanceof Error ? error.message : String(error)}`, {
        cause: error,
        retryable: isRetryableProviderError(error),
      });
    }
  }
}
