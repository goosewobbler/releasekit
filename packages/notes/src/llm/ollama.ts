import { debug } from '@releasekit/core';
import type { CompleteOptions } from '../core/types.js';
import { LLMError } from '../errors/index.js';
import { extractJsonFromResponse } from '../utils/json.js';
import { BaseLLMProvider } from './base.js';
import { LLM_DEFAULTS } from './defaults.js';
import type { CompleteResult, LLMMessage } from './messages.js';
import { debugLogMessages } from './messages.js';
import type { ProviderCapabilities } from './provider.js';

export interface OllamaConfig {
  apiKey?: string;
  baseURL?: string;
  model?: string;
}

interface OllamaChatRequest {
  model: string;
  messages: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
  }>;
  stream?: boolean;
  format?: Record<string, unknown>;
  options?: {
    num_predict?: number;
    temperature?: number;
  };
}

interface OllamaChatResponse {
  message: {
    role: string;
    content: string;
  };
  done: boolean;
}

export class OllamaProvider extends BaseLLMProvider {
  readonly name = 'ollama';
  readonly capabilities: ProviderCapabilities = {
    systemRole: true,
    structuredOutputs: true,
    toolUse: false,
  };

  private baseURL: string;
  private model: string;
  private apiKey?: string;

  constructor(config: OllamaConfig = {}) {
    super();

    this.baseURL = config.baseURL ?? process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';
    this.model = config.model ?? process.env.OLLAMA_MODEL ?? LLM_DEFAULTS.models.ollama;
    this.apiKey = config.apiKey ?? process.env.OLLAMA_API_KEY;
  }

  async complete(messages: LLMMessage[], options?: CompleteOptions): Promise<CompleteResult> {
    debugLogMessages(this.name, messages);

    const requestBody: OllamaChatRequest = {
      model: this.model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      stream: false,
      options: {
        num_predict: this.getMaxTokens(options),
        temperature: this.getTemperature(options),
      },
    };

    if (options?.schema) {
      requestBody.format = options.schema as Record<string, unknown>;
    }

    const signal = this.timeoutSignal(options);
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (this.apiKey) {
        headers.Authorization = `Bearer ${this.apiKey}`;
      }
      const baseUrl = this.baseURL.endsWith('/api') ? this.baseURL.slice(0, -4) : this.baseURL;
      const response = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
        signal,
      });

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          const text = await response.text();
          const keyHint = this.apiKey
            ? 'OLLAMA_API_KEY is set but may be invalid or rejected by the server.'
            : 'OLLAMA_API_KEY is not set. Set the environment variable or use --no-llm to skip LLM processing.';
          throw new LLMError(
            `Ollama request failed: ${response.status} ${response.statusText}${text ? ` - ${text}` : ''}. ${keyHint}`,
          );
        }
        const text = await response.text();
        throw new LLMError(`Ollama request failed: ${response.status} ${text}`);
      }

      const data = (await response.json()) as OllamaChatResponse;

      if (!data.message?.content) {
        throw new LLMError('Empty response from Ollama');
      }

      const content = data.message.content;

      if (options?.schema) {
        try {
          // Strip markdown code fences / preamble first — cloud-hosted models (e.g. via ollama.com)
          // often wrap schema-constrained output in a ```json fence despite the `format` request.
          const structured = JSON.parse(extractJsonFromResponse(content));
          return { content, structured };
        } catch (e) {
          debug(`Ollama: failed to parse structured response: ${e instanceof Error ? e.message : String(e)}`);
          return { content };
        }
      }

      return { content };
    } catch (error) {
      if (error instanceof LLMError) throw error;
      if (signal.aborted) throw new LLMError(`Ollama request timed out after ${this.getTimeout(options)}ms`);
      throw new LLMError(`Ollama error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
