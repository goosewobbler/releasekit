import { loadAuth } from '../core/config.js';
import type { ChangelogEntry, LLMConfig } from '../core/types.js';
import { LLMError } from '../errors/index.js';
import { AnthropicProvider } from './anthropic.js';
import { OllamaProvider } from './ollama.js';
import { OpenAIProvider } from './openai.js';
import { OpenAICompatibleProvider } from './openai-compatible.js';
import type { LLMProvider } from './provider.js';

export { AnthropicProvider } from './anthropic.js';
export { BaseLLMProvider } from './base.js';
export { OllamaProvider } from './ollama.js';
export { OpenAIProvider } from './openai.js';
export { OpenAICompatibleProvider } from './openai-compatible.js';
export type { LLMProvider } from './provider.js';
export { categorizeEntries } from './tasks/categorize.js';
export { enhanceEntries, enhanceEntry } from './tasks/enhance.js';
export { enhanceAndCategorize } from './tasks/enhance-and-categorize.js';
export { generateReleaseNotes } from './tasks/release-notes.js';
export { summarizeEntries } from './tasks/summarize.js';

export interface LLMContext {
  packageName?: string;
  version?: string;
  previousVersion?: string;
}

export interface EnhanceContext extends LLMContext {
  style?: string;
}

export interface SummarizeContext extends LLMContext {}

export interface CategorizeContext extends LLMContext {
  categories?: Array<{ name: string; description: string }>;
}

export interface ReleaseNotesContext extends LLMContext {
  date?: string;
}

export interface CategorizedEntries {
  category: string;
  entries: ChangelogEntry[];
}

export function createProvider(config: LLMConfig): LLMProvider {
  // Resolve API key: explicit config → auth.json → environment (handled per-provider)
  const authKeys = loadAuth();
  const apiKey = config.apiKey ?? authKeys[config.provider];

  switch (config.provider) {
    case 'openai':
      return new OpenAIProvider({
        apiKey,
        baseURL: config.baseURL,
        model: config.model,
      });

    case 'anthropic':
      return new AnthropicProvider({
        apiKey,
        model: config.model,
      });

    case 'ollama':
      return new OllamaProvider({
        apiKey,
        baseURL: config.baseURL,
        model: config.model,
      });

    case 'openai-compatible': {
      if (!config.baseURL) {
        throw new LLMError('openai-compatible provider requires baseURL');
      }
      return new OpenAICompatibleProvider({
        apiKey,
        baseURL: config.baseURL,
        model: config.model,
      });
    }

    default:
      throw new LLMError(`Unknown LLM provider: ${config.provider}`);
  }
}
