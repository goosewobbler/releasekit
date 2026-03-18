import type { CompleteOptions } from '../core/types.js';
import { LLMError } from '../errors/index.js';
import { BaseLLMProvider } from './base.js';
import { LLM_DEFAULTS } from './defaults.js';

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
  private baseURL: string;
  private model: string;
  private apiKey?: string;

  constructor(config: OllamaConfig = {}) {
    super();

    this.baseURL = config.baseURL ?? process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';
    this.model = config.model ?? LLM_DEFAULTS.models.ollama;
    this.apiKey = config.apiKey ?? process.env.OLLAMA_API_KEY;
  }

  async complete(prompt: string, options?: CompleteOptions): Promise<string> {
    const requestBody: OllamaChatRequest = {
      model: this.model,
      messages: [{ role: 'user', content: prompt }],
      stream: false,
      options: {
        num_predict: this.getMaxTokens(options),
        temperature: this.getTemperature(options),
      },
    };

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
      });

      if (!response.ok) {
        const text = await response.text();
        throw new LLMError(`Ollama request failed: ${response.status} ${text}`);
      }

      const data = (await response.json()) as OllamaChatResponse;

      if (!data.message?.content) {
        throw new LLMError('Empty response from Ollama');
      }

      return data.message.content;
    } catch (error) {
      if (error instanceof LLMError) throw error;

      throw new LLMError(`Ollama error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
