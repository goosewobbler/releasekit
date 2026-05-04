import Anthropic from '@anthropic-ai/sdk';
import type { CompleteOptions } from '../core/types.js';
import { LLMError } from '../errors/index.js';
import { BaseLLMProvider } from './base.js';
import { LLM_DEFAULTS } from './defaults.js';
import type { CompleteResult, LLMMessage } from './messages.js';
import { debugLogMessages } from './messages.js';
import type { ProviderCapabilities } from './provider.js';

export interface AnthropicConfig {
  apiKey?: string;
  model?: string;
}

export class AnthropicProvider extends BaseLLMProvider {
  readonly name = 'anthropic';
  readonly capabilities: ProviderCapabilities = {
    systemRole: true,
    structuredOutputs: true,
    toolUse: true,
  };

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

  async complete(messages: LLMMessage[], options?: CompleteOptions): Promise<CompleteResult> {
    debugLogMessages(this.name, messages);

    const systemMsg = messages.find((m) => m.role === 'system');
    const nonSystemMessages = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    try {
      if (options?.schema) {
        const toolName = options.toolName ?? 'emit_release_notes';
        const response = await this.client.messages.create({
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
        });

        const toolBlock = response.content.find((b) => b.type === 'tool_use');
        if (toolBlock?.type === 'tool_use') {
          const structured = toolBlock.input;
          return { content: JSON.stringify(structured), structured };
        }

        throw new LLMError('Expected tool_use block in Anthropic response');
      }

      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: this.getMaxTokens(options),
        system: systemMsg?.content,
        messages: nonSystemMessages,
      });

      const firstBlock = response.content[0];

      if (!firstBlock || firstBlock.type !== 'text') {
        throw new LLMError('Unexpected response format from Anthropic');
      }

      return { content: firstBlock.text };
    } catch (error) {
      if (error instanceof LLMError) throw error;

      throw new LLMError(`Anthropic API error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
