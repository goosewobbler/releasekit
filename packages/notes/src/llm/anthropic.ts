import Anthropic from '@anthropic-ai/sdk';
import type { CompleteOptions } from '../core/types.js';
import { LLMError } from '../errors/index.js';
import { BaseLLMProvider } from './base.js';
import { LLM_DEFAULTS } from './defaults.js';

export interface AnthropicConfig {
  apiKey?: string;
  model?: string;
}

export class AnthropicProvider extends BaseLLMProvider {
  readonly name = 'anthropic';
  private client: Anthropic;
  private model: string;

  constructor(config: AnthropicConfig = {}) {
    super();

    const apiKey = config.apiKey ?? process.env.ANTHROPIC_API_KEY;

    if (!apiKey) {
      throw new LLMError('Anthropic API key not configured. Set ANTHROPIC_API_KEY or use --llm-api-key');
    }

    this.client = new Anthropic({ apiKey });
    this.model = config.model ?? LLM_DEFAULTS.models.anthropic;
  }

  async complete(prompt: string, options?: CompleteOptions): Promise<string> {
    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: this.getMaxTokens(options),
        messages: [{ role: 'user', content: prompt }],
      });

      const firstBlock = response.content[0];

      if (!firstBlock || firstBlock.type !== 'text') {
        throw new LLMError('Unexpected response format from Anthropic');
      }

      return firstBlock.text;
    } catch (error) {
      if (error instanceof LLMError) throw error;

      throw new LLMError(`Anthropic API error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
