import type { CompleteOptions } from '../core/types.js';
import { LLMError } from '../errors/index.js';
import { BaseLLMProvider } from './base.js';
import { LLM_DEFAULTS } from './defaults.js';

export interface OllamaConfig {
  baseURL?: string;
  model?: string;
}

interface OllamaGenerateRequest {
  model: string;
  prompt: string;
  stream?: boolean;
  options?: {
    num_predict?: number;
    temperature?: number;
  };
}

interface OllamaGenerateResponse {
  response: string;
  done: boolean;
}

export class OllamaProvider extends BaseLLMProvider {
  readonly name = 'ollama';
  private baseURL: string;
  private model: string;

  constructor(config: OllamaConfig = {}) {
    super();

    this.baseURL = config.baseURL ?? process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';
    this.model = config.model ?? LLM_DEFAULTS.models.ollama;
  }

  async complete(prompt: string, options?: CompleteOptions): Promise<string> {
    const requestBody: OllamaGenerateRequest = {
      model: this.model,
      prompt,
      stream: false,
      options: {
        num_predict: this.getMaxTokens(options),
        temperature: this.getTemperature(options),
      },
    };

    try {
      const response = await fetch(`${this.baseURL}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new LLMError(`Ollama request failed: ${response.status} ${text}`);
      }

      const data = (await response.json()) as OllamaGenerateResponse;

      if (!data.response) {
        throw new LLMError('Empty response from Ollama');
      }

      return data.response;
    } catch (error) {
      if (error instanceof LLMError) throw error;

      throw new LLMError(`Ollama error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
