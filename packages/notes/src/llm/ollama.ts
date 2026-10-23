import { debug } from '@releasekit/core';
import type { CompleteOptions } from '../core/types.js';
import { LLMError } from '../errors/index.js';
import { extractJsonFromResponse } from '../utils/json.js';
import { BaseLLMProvider, type IdleTimeout } from './base.js';
import type { CompleteResult, LLMMessage } from './messages.js';
import { debugLogMessages } from './messages.js';
import type { ProviderCapabilities } from './provider.js';
import { isRetryableProviderError, isRetryableStatus } from './retryable.js';

export interface OllamaConfig {
  apiKey?: string;
  baseURL?: string;
  model: string;
}

interface OllamaChatRequest {
  model: string;
  messages: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
  }>;
  stream: true;
  format?: Record<string, unknown>;
  options?: {
    num_predict?: number;
    temperature?: number;
  };
}

interface OllamaChatChunk {
  message?: {
    content?: string;
  };
  done?: boolean;
  error?: string;
}

async function* ndjsonLines(body: ReadableStream<Uint8Array>, onData: () => void): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let pending = '';
  for await (const bytes of body) {
    onData();
    pending += decoder.decode(bytes, { stream: true });
    const lines = pending.split('\n');
    pending = lines.pop() ?? '';
    for (const line of lines) {
      if (line.trim()) {
        yield line;
      }
    }
  }
  pending += decoder.decode();
  if (pending.trim()) {
    yield pending;
  }
}

async function readChatStream(body: ReadableStream<Uint8Array>, idle: IdleTimeout): Promise<string> {
  let content = '';
  let last = '';
  for await (const line of ndjsonLines(body, idle.reset)) {
    last = line;
    const chunk = JSON.parse(line) as OllamaChatChunk;
    if (chunk.error) {
      throw new LLMError(`Ollama error: ${chunk.error}`, { retryable: true });
    }
    content += chunk.message?.content ?? '';
    if (chunk.done) {
      return content;
    }
  }
  throw new LLMError('Ollama stream ended before the response was complete', {
    cause: new Error(`Last line received: ${last || '(none)'}`),
    retryable: true,
  });
}

export class OllamaProvider extends BaseLLMProvider {
  readonly name = 'ollama';
  readonly capabilities: ProviderCapabilities = {
    systemRole: true,
    structuredOutputs: true,
    toolUse: false,
    honorsTemperature: true,
  };

  private baseURL: string;
  private model: string;
  private apiKey?: string;

  constructor(config: OllamaConfig) {
    super();

    this.baseURL = config.baseURL ?? process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';
    this.model = config.model;
    this.apiKey = config.apiKey ?? process.env.OLLAMA_API_KEY;
  }

  async complete(messages: LLMMessage[], options?: CompleteOptions): Promise<CompleteResult> {
    debugLogMessages(this.name, messages);

    const requestBody: OllamaChatRequest = {
      model: this.model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      stream: true,
      options: {
        num_predict: this.getMaxTokens(options),
        temperature: this.getTemperature(options),
      },
    };

    if (options?.schema) {
      requestBody.format = options.schema as Record<string, unknown>;
    }

    const idle = this.idleTimeout(options);
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
        signal: idle.signal,
      });
      idle.reset();

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          const text = await response.text();
          const keyHint = this.apiKey
            ? 'OLLAMA_API_KEY is set but may be invalid or rejected by the server.'
            : 'OLLAMA_API_KEY is not set. Set the environment variable or use --no-llm to skip LLM processing.';
          throw new LLMError(
            `Ollama request failed: ${response.status} ${response.statusText}${text ? ` - ${text}` : ''}. ${keyHint}`,
            { retryable: false },
          );
        }
        const text = await response.text();
        throw new LLMError(`Ollama request failed: ${response.status} ${text}`, {
          retryable: isRetryableStatus(response.status),
        });
      }

      const content = response.body ? await readChatStream(response.body, idle) : '';

      if (!content) {
        throw new LLMError('Empty response from Ollama');
      }

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
      if (idle.signal.aborted) {
        throw this.timeoutError(idle, 'Ollama');
      }
      if (error instanceof LLMError) {
        throw error;
      }
      throw new LLMError(`Ollama error: ${error instanceof Error ? error.message : String(error)}`, {
        cause: error,
        retryable: isRetryableProviderError(error),
      });
    } finally {
      idle.clear();
    }
  }
}
