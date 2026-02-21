import OpenAI from 'openai';
import type { CompleteOptions } from '../core/types.js';
import { LLMError } from '../errors/index.js';
import { BaseLLMProvider } from './base.js';
import { LLM_DEFAULTS } from './defaults.js';

export interface OpenAIConfig {
  apiKey?: string;
  baseURL?: string;
  model?: string;
}

export class OpenAIProvider extends BaseLLMProvider {
  readonly name = 'openai';
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

  async complete(prompt: string, options?: CompleteOptions): Promise<string> {
    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: this.getMaxTokens(options),
        temperature: this.getTemperature(options),
      });

      const content = response.choices[0]?.message?.content;

      if (!content) {
        throw new LLMError('Empty response from OpenAI');
      }

      return content;
    } catch (error) {
      if (error instanceof LLMError) throw error;

      throw new LLMError(`OpenAI API error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
