import Anthropic from '@anthropic-ai/sdk';
import type { CompleteOptions } from '../core/types.js';
import { LLMError } from '../errors/index.js';
import { BaseLLMProvider } from './base.js';
import type { CompleteResult, LLMMessage } from './messages.js';
import { debugLogMessages } from './messages.js';
import type { ProviderCapabilities } from './provider.js';
import { isRetryableProviderError } from './retryable.js';

export interface AnthropicConfig {
  apiKey?: string;
  model: string;
}

export class AnthropicProvider extends BaseLLMProvider {
  readonly name = 'anthropic';
  readonly capabilities: ProviderCapabilities = {
    systemRole: true,
    structuredOutputs: true,
    toolUse: true,
    // temperature is deliberately not forwarded (see complete()), so it must not key the cache.
    honorsTemperature: false,
  };

  private client: Anthropic;
  private model: string;

  constructor(config: AnthropicConfig) {
    super();

    const apiKey = config.apiKey ?? process.env.ANTHROPIC_API_KEY;

    if (!apiKey) {
      throw new LLMError('Anthropic API key not configured. Set ANTHROPIC_API_KEY or use --llm-api-key');
    }

    this.client = new Anthropic({ apiKey });
    this.model = config.model;
  }

  async complete(messages: LLMMessage[], options?: CompleteOptions): Promise<CompleteResult> {
    debugLogMessages(this.name, messages);

    // `options.temperature` is intentionally not passed to the Messages API: thinking-enabled models
    // (Sonnet 5, Fable 5, Opus 4.8) reject `temperature` with a 400, and releasekit uses one provider
    // for any configured model. Reflected as capabilities.honorsTemperature: false so the cache key
    // ignores it too. To honor temperature, gate it on the model and drop that capability flag.
    const systemMsg = messages.find((m) => m.role === 'system');
    const nonSystemMessages = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    const signal = this.timeoutSignal(options);
    try {
      if (options?.schema) {
        const toolName = options.toolName ?? 'emit_release_notes';
        const response = await this.client.messages.create(
          {
            model: this.model,
            max_tokens: this.getMaxTokens(options),
            system: systemMsg?.content,
            tools: [
              {
                name: toolName,
                description: 'Emit structured release notes data as JSON',
                input_schema: options.schema as Anthropic.Tool['input_schema'],
              },
            ],
            tool_choice: { type: 'tool', name: toolName },
            messages: nonSystemMessages,
          },
          { signal },
        );

        const toolBlock = response.content.find((b) => b.type === 'tool_use');
        if (toolBlock?.type === 'tool_use') {
          const structured = toolBlock.input;
          return { content: JSON.stringify(structured), structured };
        }

        throw new LLMError('Expected tool_use block in Anthropic response');
      }

      const response = await this.client.messages.create(
        {
          model: this.model,
          max_tokens: this.getMaxTokens(options),
          system: systemMsg?.content,
          messages: nonSystemMessages,
        },
        { signal },
      );

      // Find the text block rather than assuming content[0]: thinking-enabled models (Sonnet 5,
      // Fable 5) return one or more `thinking` blocks ahead of the `text` block for non-schema tasks.
      const textBlock = response.content.find((b) => b.type === 'text');

      if (textBlock?.type !== 'text') {
        throw new LLMError('Expected a text block in Anthropic response');
      }

      return { content: textBlock.text };
    } catch (error) {
      if (error instanceof LLMError) throw error;
      if (signal.aborted) {
        throw new LLMError(`Anthropic request timed out after ${this.getTimeout(options)}ms`, { retryable: true });
      }
      throw new LLMError(`Anthropic API error: ${error instanceof Error ? error.message : String(error)}`, {
        cause: error,
        retryable: isRetryableProviderError(error),
      });
    }
  }
}
