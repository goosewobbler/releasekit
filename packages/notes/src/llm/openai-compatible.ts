import OpenAI from 'openai';
import type { CompleteOptions } from '../core/types.js';
import { LLMError } from '../errors/index.js';
import { BaseLLMProvider } from './base.js';
import type { CompleteResult, LLMMessage } from './messages.js';
import { debugLogMessages } from './messages.js';
import { readChatCompletionStream } from './openai.js';
import type { ProviderCapabilities } from './provider.js';

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

    return this.withIdleTimeout(this.name, options, async (idle) => {
      const openaiMessages = messages.map((m) => ({ role: m.role, content: m.content }));

      const requestParams = {
        model: this.model,
        messages: openaiMessages,
        max_tokens: this.getMaxTokens(options),
        temperature: this.getTemperature(options),
        stream: true as const,
      };

      const stream = await this.client.chat.completions.create(requestParams, { signal: idle.signal });
      idle.reset();
      const content = await readChatCompletionStream(stream, idle, this.name);

      if (!content) {
        throw new LLMError('Empty response from LLM');
      }

      return { content };
    });
  }
}
