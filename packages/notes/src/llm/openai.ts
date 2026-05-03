import { debug } from '@releasekit/core';
import OpenAI from 'openai';
import type { CompleteOptions } from '../core/types.js';
import { LLMError } from '../errors/index.js';
import { BaseLLMProvider } from './base.js';
import { LLM_DEFAULTS } from './defaults.js';
import type { CompleteResult, LLMMessage } from './messages.js';
import { debugLogMessages } from './messages.js';
import type { ProviderCapabilities } from './provider.js';

export interface OpenAIConfig {
  apiKey?: string;
  baseURL?: string;
  model?: string;
}

export class OpenAIProvider extends BaseLLMProvider {
  readonly name = 'openai';
  readonly capabilities: ProviderCapabilities = {
    systemRole: true,
    structuredOutputs: true,
    toolUse: false,
  };

  private client: OpenAI;
  private model: string;

  constructor(config: OpenAIConfig = {}) {
    super();

    const apiKey = config.apiKey ?? process.env.OPENAI_API_KEY;

    if (!apiKey) {
      throw new LLMError('OpenAI API key not configured. Set OPENAI_API_KEY or use --llm-api-key');
    }

    this.client = new OpenAI({
      apiKey,
      baseURL: config.baseURL,
    });

    this.model = config.model ?? LLM_DEFAULTS.models.openai;
  }

  async complete(messages: LLMMessage[], options?: CompleteOptions): Promise<CompleteResult> {
    debugLogMessages(this.name, messages);

    try {
      const openaiMessages = messages.map((m) => ({ role: m.role, content: m.content }));

      const requestParams = {
        model: this.model,
        messages: openaiMessages,
        max_tokens: this.getMaxTokens(options),
        temperature: this.getTemperature(options),
        stream: false as const,
        ...(options?.schema && {
          response_format: {
            type: 'json_schema' as const,
            json_schema: {
              name: options.toolName ?? 'release_notes',
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              schema: options.schema as any,
              strict: true,
            },
          },
        }),
      };

      const response = await this.client.chat.completions.create(requestParams);

      const content = response.choices[0]?.message?.content;

      if (!content) {
        throw new LLMError('Empty response from OpenAI');
      }

      if (options?.schema) {
        try {
          const structured = JSON.parse(content);
          return { content, structured };
        } catch (e) {
          debug(`OpenAI: failed to parse structured response: ${e instanceof Error ? e.message : String(e)}`);
          return { content };
        }
      }

      return { content };
    } catch (error) {
      if (error instanceof LLMError) throw error;

      throw new LLMError(`OpenAI API error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
